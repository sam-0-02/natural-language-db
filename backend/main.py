from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from openai import OpenAI
import sqlite3
from fastapi.middleware.cors import CORSMiddleware
import whisper
import shutil
import os

app = FastAPI(title="Natural Language DB Agent - Pro")
whisper_model = whisper.load_model("base")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(
    base_url="http://localhost:1234/v1", 
    api_key="lm-studio"
)

# --- MODELS ---
class QueryRequest(BaseModel):
    user_prompt: str
    history: list = []  # Added to support conversation memory

class ExecuteRequest(BaseModel):
    sql_query: str

# --- HELPER FUNCTIONS ---

def get_dynamic_schema():
    conn = sqlite3.connect("company_data.db")
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in cursor.fetchall()]
    
    schema_text = ""
    for table in tables:
        cursor.execute(f"PRAGMA table_info({table})")
        columns = cursor.fetchall()
        column_names = [f"{col[1]} ({col[2]})" for col in columns]
        schema_text += f"Table: {table}\nColumns: {', '.join(column_names)}\n\n"
    conn.close()
    return schema_text

def analyze_query(sql_query):
    # Strip whitespace and common AI filler words before checking safety
    clean_sql = sql_query.split(';')[0].strip().upper()
    destructive_actions = ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE"]
    
    # Check if any destructive keyword starts the query logic
    for action in destructive_actions:
        if clean_sql.startswith(action) or f" {action} " in f" {clean_sql} ":
            return {"is_safe": False, "type": action}
            
    return {"is_safe": True, "type": "SELECT"}

def execute_sql(query: str):
    conn = sqlite3.connect("company_data.db")
    conn.row_factory = sqlite3.Row 
    cursor = conn.cursor()
    try:
        cursor.execute(query)
        if query.strip().upper().startswith("SELECT"):
            return [dict(row) for row in cursor.fetchall()]
        else:
            conn.commit()
            # For CREATE/DROP, rows_affected is 0, which is normal!
            return {
                "status": "success", 
                "rows_affected": cursor.rowcount,
                "message": "Schema modified successfully" 
            }
    except Exception as e:
        return {"database_error": str(e)}
    finally:
        conn.close()

# --- ENDPOINTS ---

@app.post("/voice-to-text")
async def voice_to_text(file: UploadFile = File(...)):
    temp_file = f"temp_{file.filename}"
    try:
        with open(temp_file, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        result = whisper_model.transcribe(temp_file, fp16=False)
        return {"transcription": result["text"].strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)

@app.post("/generate-query")
async def generate_query(request: QueryRequest):
    personal_context = {}
    try:
        # 1. Fetch Schema and Personal Settings
        schema_info = get_dynamic_schema()
        try:
            conn = sqlite3.connect("company_data.db")
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings")
            personal_context = dict(cursor.fetchall())
            conn.close()
        except:
            personal_context = {"user_name": "User", "my_user_id": "1"}

        # 2. Setup System Prompt with Strict Output Rules
        system_prompt = f"""
You are a SQL-only generator.
SCHEMA: {schema_info}

RULES:
- ONLY output valid SQLite code.
- NEVER explain the query.
- NEVER start with "The data shows..." or "Here is your query".
- If you don't know the answer, output: SELECT 'Error' as Message;

GOOD EXAMPLE: SELECT * FROM users;
BAD EXAMPLE: Here is the data: SELECT * FROM users;

You are integrated into a system that HAS charting capabilities.
When the user asks for a chart or graph:
1. DO NOT apologize or say you cannot make charts.
2. Simply generate the SQL query that returns the labels and numeric values.
3. Example: If asked for a salary chart, return 'SELECT department, AVG(salary) FROM users GROUP BY department'

"""

        # 3. Construct message list with History
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(request.history) # Add previous chat turns
        messages.append({"role": "user", "content": request.user_prompt})

        response = client.chat.completions.create(
            model="local-model", 
            messages=messages,
            temperature=0.0 
        )

        ai_sql = response.choices[0].message.content.strip()
        # Clean up any potential markdown formatting
        ai_sql = ai_sql.replace("```sql", "").replace("```", "").split(';')[0].strip()
        
        # 4. Analyze Safety
        analysis = analyze_query(ai_sql)
        
        if analysis["is_safe"]:
            db_results = execute_sql(ai_sql)
            
            # 5. Generate Natural Language Summary
            summary_prompt = f"User: {request.user_prompt}\nData: {db_results}\nSummarize in 1 short sentence:"
            summary_res = client.chat.completions.create(
                model="local-model",
                messages=[{"role": "user", "content": summary_prompt}],
                temperature=0.7
            )
            summary_text = summary_res.choices[0].message.content.strip()

            return {
                "status": "executed",
                "query_type": analysis["type"],
                "generated_sql": ai_sql,
                "data": db_results,
                "summary": summary_text
            }
        else:
            return {
                "status": "requires_confirmation",
                "warning": f"This is a destructive {analysis['type']} operation.",
                "generated_sql": ai_sql,
                "data": None,
                "summary": "I need your confirmation to run this update."
            }

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/list-tables")
async def list_tables():
    try:
        conn = sqlite3.connect("company_data.db")
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables = [row[0] for row in cursor.fetchall()]
        conn.close()
        return {"tables": tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete-table/{table_name}")
async def delete_table(table_name: str):
    try:
        if table_name.lower().startswith("sqlite_"):
            raise HTTPException(status_code=400, detail="Cannot delete system tables.")
        conn = sqlite3.connect("company_data.db")
        cursor = conn.cursor()
        cursor.execute(f"DROP TABLE IF EXISTS {table_name}")
        conn.commit()
        conn.close()
        return {"message": f"Table {table_name} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/execute-confirmed-query")
async def execute_confirmed_query(request: ExecuteRequest):
    try:
        db_results = execute_sql(request.sql_query)
        return {
            "status": "success",
            "message": "Query executed successfully.",
            "executed_sql": request.sql_query,
            "result": db_results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))