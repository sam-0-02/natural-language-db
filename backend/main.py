from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from openai import OpenAI
import sqlite3
from fastapi.middleware.cors import CORSMiddleware
import whisper
import shutil
import os
import pandas as pd
import re
from fastapi.responses import FileResponse,  Response
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
    history: list = []  
    target_table: Optional[str] = None  # NEW: Optional target table for scoped chat

class ExecuteRequest(BaseModel):
    sql_query: str

# --- HELPER FUNCTIONS ---

def get_dynamic_schema(target_table: str = None):
    conn = sqlite3.connect("company_data.db")
    cursor = conn.cursor()
    
    # If a target table is provided, only fetch that one. Otherwise, fetch all.
    if target_table:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?;", (target_table,))
    else:
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
            table_match = re.search(r'(?:INTO|TABLE|UPDATE)\s+([a-zA-Z0-9_]+)', query, re.IGNORECASE)
            table_name = table_match.group(1) if table_match else "Unknown"
            
            cursor.execute(
                "INSERT INTO audit_log (action_type, query_executed, table_affected) VALUES (?, ?, ?)",
                (query.split()[0].upper(), query, table_name)
            )
            conn.commit()
            
            return {
                "status": "success", 
                "rows_affected": cursor.rowcount,
                "message": "Schema modified successfully" 
            }
    except Exception as e:
        return {"database_error": str(e)}
    finally:
        conn.close()


def init_audit_log():
    conn = sqlite3.connect("company_data.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT,
            query_executed TEXT,
            table_affected TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

init_audit_log() # Run on startup

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
        # 1. Fetch Schema (Scoped to target table if provided)
        schema_info = get_dynamic_schema(request.target_table)
        
        try:
            conn = sqlite3.connect("company_data.db")
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings")
            personal_context = dict(cursor.fetchall())
            conn.close()
        except:
            personal_context = {"user_name": "User", "my_user_id": "1"}

        # 2. Setup System Prompt with Strict Output Rules & Scope
        scope_warning = f"You are restricted to querying ONLY the '{request.target_table}' table." if request.target_table else "You may query any of the provided tables."

        system_prompt = f"""
You are a SQL-only generator.
SCOPE: {scope_warning}
SCHEMA: 
{schema_info}

Personal Context: {personal_context}
My ID is {personal_context.get('my_user_id', '1')}.

RULES:
- ONLY output valid SQLite code.
- NEVER explain the query.
- NEVER start with "The data shows..." or "Here is your query".
- SQLITE IS CASE-SENSITIVE: Use LOWER() for string comparisons.
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
        messages.extend(request.history) 
        messages.append({"role": "user", "content": request.user_prompt})

        response = client.chat.completions.create(
            model="local-model", 
            messages=messages,
            temperature=0.0 
        )

        ai_sql = response.choices[0].message.content.strip()
        # Clean up any potential markdown formatting and extract ONLY the query
        ai_sql = ai_sql.replace("```sql", "").replace("```", "").split(';')[0].strip()
        
        if "SELECT" in ai_sql.upper() and not ai_sql.upper().startswith("SELECT"):
             # Sometimes models prepend chatter, strip everything before 'SELECT'
             ai_sql = ai_sql[ai_sql.upper().find("SELECT"):]
        
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

@app.post("/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    try:
        raw_name = file.filename.rsplit('.', 1)[0]
        table_name = re.sub(r'\W+', '_', raw_name).lower()
        
        if table_name.startswith("sqlite_") or table_name == "settings":
            raise HTTPException(status_code=400, detail="Invalid table name derived from file.")

        df = pd.read_csv(file.file)
        df.columns = [re.sub(r'\W+', '_', col).lower() for col in df.columns]

        conn = sqlite3.connect("company_data.db")
        df.to_sql(table_name, conn, if_exists="replace", index=False) 
        conn.close()

        return {
            "status": "success", 
            "message": f"File uploaded and converted to table: '{table_name}'",
            "columns": list(df.columns),
            "row_count": len(df)
        }

    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="The uploaded CSV file is empty.")
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/download-table/{table_name}")
async def download_table(table_name: str, format: str = "csv"):
    try:
        conn = sqlite3.connect("company_data.db")
        
        # Security: Verify the table actually exists before querying
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?;", (table_name,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Table not found.")

        # Load the specific table into Pandas
        df = pd.read_sql_query(f"SELECT * FROM {table_name}", conn)
        conn.close()

        # Convert to requested format
        if format.lower() == "json":
            file_content = df.to_json(orient="records")
            media_type = "application/json"
            filename = f"{table_name}_export.json"
        else:
            file_content = df.to_csv(index=False)
            media_type = "text/csv"
            filename = f"{table_name}_export.csv"

        # Return as a downloadable file
        return Response(
            content=file_content,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@app.get("/audit-history")
async def get_audit_history():
    try:
        conn = sqlite3.connect("company_data.db")
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50")
        logs = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return {"history": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))