# DataQuery Pro: Local AI SQL Agent

DataQuery Pro is a professional, local-first data analytics platform that allows users to interact with their databases using natural language. By combining **FastAPI**, **React**, and **Local LLMs (via LM Studio)**, this tool provides a secure, private, and intuitive way to analyze data without writing a single line of SQL.

## 🚀 Key Features

* **Dual-Scope Intelligence:** Switch between a "Global Chat" for relational joins across multiple tables and a "Table-Specific" chat for deep-dives into single datasets.
* **Dynamic CSV Ingestion:** Drag-and-drop CSV files to instantly convert them into queryable SQLite tables.
* **Natural Language to SQL:** Powered by local LLMs, translating complex human questions into precise SQLite queries.
* **Integrated Data Visualization:** Automatic generation of charts and graphs for trend analysis.
* **Audit Logging:** A persistent transaction history that tracks every structural change (INSERT, UPDATE, DELETE, DROP) for security and transparency.
* **Voice-Activated Queries:** Built-in speech-to-text using OpenAI Whisper for hands-free data exploration.
* **Privacy First:** 100% local execution. No data leaves your machine.

## 🛠️ Technical Stack

### Frontend
- **React (Vite)**
- **Lucide React** (Professional Iconography)
- **Recharts** (Dynamic Visualization)
- **Axios** (API Communication)

### Backend
- **FastAPI** (Python High-Performance Web Framework)
- **Pandas** (Data Processing & CSV Management)
- **SQLite** (Relational Storage)
- **OpenAI Whisper** (Local Audio Transcription)

### AI Inference
- **LM Studio** (Local OpenAI-compatible API)
- **Model:** GGUF Quantized Models (Llama 3 / Mistral)

## 🏗️ Architecture



The system uses a **Dynamic Schema Injection** pattern. When a user asks a question, the backend inspects the current SQLite schema, injects the column definitions into the LLM system prompt, and executes the returned SQL safely via a security middleware layer.

## 🚦 Getting Started

### Prerequisites
- Python 3.9+
- Node.js & npm
- LM Studio (running a local server at `localhost:1234`)
- **FFmpeg**: Required for audio processing.
  - *Windows:* `choco install ffmpeg` or download from ffmpeg.org
  - *Mac:* `brew install ffmpeg`
  - *Linux:* `sudo apt install ffmpeg`
### Backend Setup
1. `cd backend`
2. `python -m venv .venv`
3. `source .venv/bin/activate` (or `.venv\Scripts\activate` on Windows)
4. `pip install -r requirements.txt`
5. `uvicorn main:app --reload`

### Frontend Setup
1. `cd frontend`
2. `npm install`
3. `npm run dev`

## 🛡️ Security
The application includes an **AI Safety Shield** that intercepts destructive SQL commands. Destructive actions like `DROP TABLE` or `DELETE` require explicit user confirmation via the UI before execution.