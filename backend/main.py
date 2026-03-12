from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI
import sqlite3

app = FastAPI(title="Natural Language DB Agent - Secure")

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

@app.post("/generate-query")
async def generate_query(request: QueryRequest):
    try:
        system_prompt = f"""
        You are an expert SQLite database assistant. 
        Convert the user's natural language request into a valid SQLite query.
        
        Here is the database schema you MUST use:
        {DB_SCHEMA}
        
        Return ONLY the SQL code. Do not include markdown formatting like ```sql.
        Do not include any explanations.
        IMPORTANT: For text comparisons, always use the LIKE operator or LOWER() to ensure case-insensitivity.
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
        
        # --- NEW PIPELINE LOGIC ---
        analysis = analyze_query(ai_sql)
        
        if analysis["is_safe"]:
            # It's a SELECT, execute it immediately
            db_results = execute_sql(ai_sql)
            return {
                "status": "executed",
                "query_type": analysis["type"],
                "generated_sql": ai_sql,
                "data": db_results
            }
        else:
            # It's a modification, DO NOT execute. Return it for confirmation.
            return {
                "status": "requires_confirmation",
                "warning": f"This is a destructive {analysis['type']} operation. Please confirm before execution.",
                "query_type": analysis["type"],
                "generated_sql": ai_sql,
                "data": None
            }

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