from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from openai import OpenAI
import sqlite3
from fastapi.middleware.cors import CORSMiddleware # 1. Import this
import whisper
import shutil
import os


app = FastAPI(title="Natural Language DB Agent - Secure")
whisper_model = whisper.load_model("base")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Your Vite frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(
    base_url="http://localhost:1234/v1", 
    api_key="lm-studio"
)

class QueryRequest(BaseModel):
    user_prompt: str

DB_SCHEMA = """
Table: users
Columns:
- id (INTEGER, PRIMARY KEY)
- name (TEXT)
- age (INTEGER)
- department (TEXT)
- salary (INTEGER)
"""
@app.post("/voice-to-text")
async def voice_to_text(file: UploadFile = File(...)):
    temp_file = f"temp_{file.filename}"
    try:
        # Save the incoming chunk
        with open(temp_file, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Transcribe using the CPU (fp16=False avoids the warning)
        # Note: Whisper calls 'ffmpeg' internally here.
        result = whisper_model.transcribe(temp_file, fp16=False)
        return {"transcription": result["text"].strip()}

    except Exception as e:
        error_msg = str(e)
        if "WinError 2" in error_msg:
            print("❌ SYSTEM ERROR: FFmpeg not found. Please ensure FFmpeg is installed and in your PATH.")
        raise HTTPException(status_code=500, detail=error_msg)
    
    finally:
        # Now 'os' is imported, so this won't crash!
        if os.path.exists(temp_file):
            os.remove(temp_file)

def generate_summary(user_prompt, data):
    summary_prompt = f"""
    The user asked: "{user_prompt}"
    The database returned: {data}
    
    Briefly summarize these results in one natural-sounding sentence. 
    If no data was found, politely let them know.
    """
    
    response = client.chat.completions.create(
        model="local-model",
        messages=[{"role": "user", "content": summary_prompt}],
        temperature=0.7
    )
    return response.choices[0].message.content.strip()

def execute_sql(query: str):
    conn = sqlite3.connect("company_data.db")
    conn.row_factory = sqlite3.Row 
    cursor = conn.cursor()
    
    try:
        cursor.execute(query)
        # If it's a SELECT, fetch the results
        if query.strip().upper().startswith("SELECT"):
            results = [dict(row) for row in cursor.fetchall()]
            return results
        else:
            # For INSERT, UPDATE, DELETE, we must commit the changes
            conn.commit()
            return {"status": "success", "rows_affected": cursor.rowcount}
    except Exception as e:
        return {"database_error": str(e)}
    finally:
        conn.close()

# --- NEW SECURITY LAYER ---
def analyze_query(query: str):
    query_upper = query.strip().upper()
    
    if query_upper.startswith("SELECT"):
        return {"is_safe": True, "type": "READ"}
    elif query_upper.startswith("INSERT"):
        return {"is_safe": False, "type": "CREATE"}
    elif query_upper.startswith("UPDATE"):
        return {"is_safe": False, "type": "UPDATE"}
    elif query_upper.startswith("DELETE"):
        return {"is_safe": False, "type": "DELETE"}
    else:
        return {"is_safe": False, "type": "UNKNOWN"}
    

def get_dynamic_schema():
    conn = sqlite3.connect("company_data.db")
    cursor = conn.cursor()
    
    # Get all table names
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


@app.post("/generate-query")
async def generate_query(request: QueryRequest):
    try:
        schema_info = get_dynamic_schema()
        # 1. Generate the SQL Query
        system_prompt = f"""
        You are an expert SQLite database assistant. 
        Convert the user's natural language request into a valid SQLite query.
        
        Here is the dynamic database schema you MUST use:
        {schema_info}
        
        Return ONLY the SQL code. No markdown, no explanations.
        IMPORTANT: Use LOWER() for all text comparisons to stay case-insensitive.
        If the user asks to create a table, generate a valid 'CREATE TABLE' statement.
        """
        response = client.chat.completions.create(
            model="local-model", 
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.user_prompt}
            ],
            temperature=0.1 
        )

        ai_sql = response.choices[0].message.content.strip()
        ai_sql = ai_sql.replace("```sql", "").replace("```", "").strip()
        
        # 2. Analyze Query Security
        analysis = analyze_query(ai_sql)
        
        if analysis["is_safe"]:
            # It's a SELECT, execute it immediately
            db_results = execute_sql(ai_sql)

            # 3. Generate a Natural Language Summary of the findings
            summary_text = "Here are the results from the database." # Default fallback
            
            if db_results and len(db_results) > 0:
                summary_prompt = f"""
                User Question: {request.user_prompt}
                Database Results: {db_results}
                
                Based on the data above, provide a very brief, one-sentence summary for the user. 
                Example: 'I found 3 employees in the Engineering department.'
                """
                
                summary_res = client.chat.completions.create(
                    model="local-model",
                    messages=[{"role": "user", "content": summary_prompt}],
                    temperature=0.7
                )
                summary_text = summary_res.choices[0].message.content.strip()
            else:
                summary_text = "I couldn't find any data matching your request."

            return {
                "status": "executed",
                "query_type": analysis["type"],
                "generated_sql": ai_sql,
                "data": db_results,
                "summary": summary_text
            }
            
        else:
            # It's a modification (INSERT/UPDATE/DELETE), DO NOT execute yet.
            return {
                "status": "requires_confirmation",
                "warning": f"This is a destructive {analysis['type']} operation. Please confirm before execution.",
                "query_type": analysis["type"],
                "generated_sql": ai_sql,
                "data": None,
                "summary": "This action requires your approval before I can modify the database."
            }

    except Exception as e:
        print(f"Error in generate_query: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/list-tables")
async def list_tables():
    try:
        conn = sqlite3.connect("company_data.db")
        cursor = conn.cursor()
        # Fetch names of all tables you created
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables = [row[0] for row in cursor.fetchall()]
        conn.close()
        return {"tables": tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Create a new structure for confirmed queries
class ExecuteRequest(BaseModel):
    sql_query: str

@app.post("/execute-confirmed-query")
async def execute_confirmed_query(request: ExecuteRequest):
    try:
        # We pass the confirmed SQL directly to our execution function
        db_results = execute_sql(request.sql_query)
        
        return {
            "status": "success",
            "message": "Query executed successfully.",
            "executed_sql": request.sql_query,
            "result": db_results
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))