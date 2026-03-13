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

  // 2. Shared Search Logic
  const performSearch = async (queryText) => {
    if (!queryText.trim()) return;
    const wantsChart = /chart|graph|plot/i.test(queryText);
    
    setMessages((prev) => [...prev, { role: 'user', content: queryText }]);
    setLoading(true);

    try {
      const response = await axios.post('http://localhost:8000/generate-query', {
        user_prompt: queryText
      });

      setMessages((prev) => [...prev, { 
        role: 'system', 
        data: response.data,
        wantsChart: wantsChart 
      }]);
      
      // If a new table was created, refresh the sidebar
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
      fetchTableList(); // Refresh sidebar in case table was deleted/created
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
        {tables.map((table) => (
          <div 
            key={table} 
            className="table-item" 
            onClick={() => performSearch(`Show all data from ${table}`)}
          >
            📂 {table}
          </div>
        ))}
      </div>

      {/* MAIN CONTENT */}
      <div className="main-content">
        <div className="chat-header">
          <h2 style={{ margin: 0 }}>AI Data Manager</h2>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Local Model Connected</span>
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
                          <tr>
                            {Object.keys(msg.data.data[0]).map(key => <th key={key}>{key}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {msg.data.data.map((row, i) => (
                            <tr key={i}>
                              {Object.values(row).map((val, j) => <td key={j}>{val}</td>)}
                            </tr>
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
            placeholder="Query your tables or type 'Create table...'" 
          />
          <button 
            type="button" 
            onClick={toggleRecording} 
            style={{ background: isRecording ? '#ef4444' : '#334155', minWidth: '80px' }}
          >
            {isRecording ? 'Stop' : '🎤 Mic'}
          </button>
          <button type="submit" disabled={loading || isRecording}>Send</button>
        </form>
      </div>
    </div>
  );
}

export default App;