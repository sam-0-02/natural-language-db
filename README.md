# Natural Language Database Agent 🤖📊

A full-stack AI agent that allows users to query a database using natural language or voice. It generates SQL, executes it securely, and visualizes the results.

## 🚀 Features
- **Text-to-SQL:** Uses local LLMs (via LM Studio) to convert English into SQLite queries.
- **Voice Interface:** Integrated OpenAI Whisper for local speech-to-text transcription.
- **Data Visualization:** Automatically generates bar charts using Recharts.
- **Security Shield:** Detects and requires confirmation for destructive operations (UPDATE/DELETE).
- **Local-First:** All processing (LLM, STT, Database) happens on your machine.

## 🛠️ Tech Stack
- **Frontend:** React, Vite, Axios, Recharts, Lucide Icons.
- **Backend:** FastAPI, Python, SQLite, OpenAI Whisper.
- **AI Engine:** LM Studio (Local Inference).

## 📋 Prerequisites
- Python 3.10+
- Node.js & npm
- FFmpeg (for voice processing)
- LM Studio (running a local model)

## 🔧 Setup
1. **Backend:**
   - `cd backend`
   - `pip install -r requirements.txt`
   - `python init_db.py` (to create dummy data)
   - `uvicorn main:app --reload`

2. **Frontend:**
   - `cd frontend`
   - `npm install`
   - `npm run dev`