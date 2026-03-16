import { useState, useEffect } from 'react'
import axios from 'axios'
import DynamicChart from './DynamicChart'

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [tables, setTables] = useState([])
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [globalSearch, setGlobalSearch] = useState('')

  // 1. Fetch tables from backend on mount
  useEffect(() => {
    fetchTableList();
  }, []);

  const fetchTableList = async () => {
    try {
      const res = await axios.get('http://localhost:8000/list-tables');
      setTables(res.data.tables);
    } catch (err) {
      console.error("Could not fetch tables", err);
    }
  };

  const handleDeleteTable = async (tableName) => {
    const confirmed = window.confirm(`Are you sure you want to PERMANENTLY delete the table "${tableName}"?`);
    if (confirmed) {
      try {
        setLoading(true);
        await axios.delete(`http://localhost:8000/delete-table/${tableName}`);
        fetchTableList();
        setMessages(prev => [...prev, { 
          role: 'system', 
          successMsg: `Table "${tableName}" has been removed.` 
        }]);
      } catch (err) {
        alert("Failed to delete table.");
      } finally {
        setLoading(false);
      }
    }
  };

  // 2. Updated Search Logic with Chat History (Memory)
  const performSearch = async (queryText) => {
    if (!queryText.trim()) return;
    const wantsChart = /chart|graph|plot/i.test(queryText);
    
    // Construct history for the AI (last 6 messages for context)
    const history = messages.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content || m.data?.summary || "Data retrieved."
    }));

    setMessages((prev) => [...prev, { role: 'user', content: queryText }]);
    setLoading(true);
    
    try {
      const response = await axios.post('http://localhost:8000/generate-query', {
        user_prompt: queryText,
        history: history // NEW: Sending the context to the backend
      });

      setMessages((prev) => [...prev, { 
        role: 'system', 
        data: response.data,
        wantsChart: wantsChart 
      }]);
      
      if (queryText.toLowerCase().includes("create table")) {
        fetchTableList();
      }
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'system', error: 'Server connection failed.' }]);
    } finally {
      setLoading(false);
    }
  };

  // 3. Voice Logic
  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorder) mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      let chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', blob, 'recording.webm');
        setLoading(true);
        try {
          const res = await axios.post('http://localhost:8000/voice-to-text', formData);
          setInput(res.data.transcription);
          await performSearch(res.data.transcription);
        } catch (err) {
          console.error("Transcription error", err);
        } finally {
          setLoading(false);
          setIsRecording(false);
          stream.getTracks().forEach(track => track.stop());
        }
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      alert("Mic access denied");
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    performSearch(input);
    setInput('');
  };

  const confirmExecution = async (sqlQuery) => {
    setLoading(true);
    try {
      await axios.post('http://localhost:8000/execute-confirmed-query', { sql_query: sqlQuery });
      setMessages((prev) => [...prev, { role: 'system', successMsg: "Query executed successfully!" }]);
      fetchTableList();
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'system', error: 'Execution failed.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-container">
      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-title">Database Explorer</div>
        
        <div style={{ padding: '0 8px 20px 8px' }}>
          <div style={{ position: 'relative' }}>
            <input 
              type="text" 
              placeholder="Global Search..." 
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  performSearch(`Search all tables for '${globalSearch}'`);
                  setGlobalSearch('');
                }
              }}
              style={{ 
                width: '100%',
                padding: '10px 12px',
                fontSize: '13px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: 'white',
                outline: 'none'
              }}
            />
          </div>
        </div>

        <div className="sidebar-title" style={{ fontSize: '11px', marginTop: '10px' }}>Your Tables</div>

        {tables.map((table) => (
          <div key={table} className="table-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
            <span onClick={() => performSearch(`Show all data from ${table}`)} style={{ flex: 1, cursor: 'pointer' }}>
              📁 {table}
            </span>
            <button 
              onClick={(e) => { e.stopPropagation(); handleDeleteTable(table); }}
              className="delete-btn"
              style={{ background: 'transparent', color: '#f87171', border: 'none', cursor: 'pointer', opacity: 0.6 }}
              onMouseEnter={(e) => e.target.style.opacity = 1}
              onMouseLeave={(e) => e.target.style.opacity = 0.6}
            >
              🗑️
            </button>
          </div>
        ))}
      </div>

      {/* MAIN CONTENT */}
      <div className="main-content">
        <div className="chat-header">
          <h2 style={{ margin: 0 }}>AI Data Manager</h2>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Mode: Relational Memory</span>
        </div>

        <div className="messages-area">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role === 'user' ? 'user-message' : 'ai-message'}`}>
              {msg.content && <div>{msg.content}</div>}
              {msg.error && <div style={{ color: '#f87171' }}>❌ {msg.error}</div>}
              {msg.successMsg && <div style={{ color: '#4ade80' }}>✅ {msg.successMsg}</div>}

              {msg.data && (
                <div style={{ marginTop: '10px' }}>
                  {msg.data.summary && <p style={{ color: '#e2e8f0', fontWeight: '500' }}>{msg.data.summary}</p>}
                  <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '10px' }}>
                    SQL: <code>{msg.data.generated_sql || msg.data.executed_sql}</code>
                  </div>

                  {msg.data.status === 'requires_confirmation' && (
                    <div style={{ background: 'rgba(248, 113, 113, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid #f87171' }}>
                      <p style={{ color: '#f87171', margin: '0 0 10px 0' }}>{msg.data.warning}</p>
                      <button onClick={() => confirmExecution(msg.data.generated_sql)}>Confirm Execute</button>
                    </div>
                  )}

                  {msg.data.data && msg.data.data.length > 0 && (
                    <div className="data-table-container">
                      {msg.wantsChart && <DynamicChart data={msg.data.data} />}
                      <table>
                        <thead>
                          <tr>{Object.keys(msg.data.data[0]).map(key => <th key={key}>{key}</th>)}</tr>
                        </thead>
                        <tbody>
                          {msg.data.data.map((row, i) => (
                            <tr key={i}>{Object.values(row).map((val, j) => <td key={j}>{val}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="message ai-message"><em>Processing...</em></div>}
        </div>

        <form onSubmit={handleFormSubmit} className="input-area">
          <input 
            type="text" 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            placeholder="Query your database..." 
          />
          <button type="button" onClick={toggleRecording} style={{ background: isRecording ? '#ef4444' : '#334155', minWidth: '80px' }}>
            {isRecording ? 'Stop' : '🎤 Mic'}
          </button>
          <button type="submit" disabled={loading || isRecording}>Send</button>
        </form>
      </div>
    </div>
  );
}

export default App;