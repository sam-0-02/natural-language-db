import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { 
  Database, 
  UploadCloud, 
  Download, 
  Trash2, 
  Globe, 
  History, 
  Mic, 
  Send, 
  Square,
  AlertCircle,
  ChevronRight,
  FileText,
  Loader2
} from 'lucide-react'
import DynamicChart from './DynamicChart'
import './App.css'

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [tables, setTables] = useState([])
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  
  // New States for Professional UI
  const [activeTable, setActiveTable] = useState(null)
  const [currentData, setCurrentData] = useState(null) // Holds the latest table/chart to display below
  const [showHistory, setShowHistory] = useState(false)
  const [auditLog, setAuditLog] = useState([])
  
  const messagesEndRef = useRef(null)

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Initial Fetches
  useEffect(() => {
    fetchTableList();
    fetchAuditHistory();
  }, []);

  const fetchTableList = async () => {
    try {
      const res = await axios.get('http://localhost:8000/list-tables');
      setTables(res.data.tables);
    } catch (err) {
      console.error("Could not fetch tables", err);
    }
  };

  const fetchAuditHistory = async () => {
    try {
      const res = await axios.get('http://localhost:8000/audit-history');
      setAuditLog(res.data.history);
    } catch (err) {
      console.error("Could not fetch history", err);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      alert('Please upload a valid CSV file.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setLoading(true);
    try {
      const res = await axios.post('http://localhost:8000/upload-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      fetchTableList();
      fetchAuditHistory();
      setMessages(prev => [...prev, { role: 'system', successMsg: `✅ ${res.data.message}` }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', error: 'Failed to upload CSV.' }]);
    } finally {
      setLoading(false);
      event.target.value = null; 
    }
  };

  const handleDeleteTable = async (tableName) => {
    if (window.confirm(`Permanently delete the table "${tableName}"?`)) {
      try {
        setLoading(true);
        await axios.delete(`http://localhost:8000/delete-table/${tableName}`);
        fetchTableList();
        fetchAuditHistory();
        if (activeTable === tableName) setActiveTable(null);
        setMessages(prev => [...prev, { role: 'system', successMsg: `Table "${tableName}" removed.` }]);
      } catch (err) {
        alert("Failed to delete table.");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDownloadTable = (tableName, format = 'csv') => {
    window.open(`http://localhost:8000/download-table/${tableName}?format=${format}`, '_blank');
  };

  const performSearch = async (queryText) => {
    if (!queryText.trim()) return;
    const wantsChart = /chart|graph|plot/i.test(queryText);
    
    const history = messages.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content || m.data?.summary || "Data retrieved."
    }));

    setMessages((prev) => [...prev, { role: 'user', content: queryText }]);
    setLoading(true);
    
    try {
      const response = await axios.post('http://localhost:8000/generate-query', {
        user_prompt: queryText,
        history: history,
        target_table: activeTable
      });

      const aiData = response.data;
      setMessages((prev) => [...prev, { role: 'system', data: aiData }]);
      
      // If we got actual data back, push it to the Bottom Grid Panel
      if (aiData.data && Array.isArray(aiData.data) && aiData.data.length > 0) {
        setCurrentData({ rows: aiData.data, wantsChart: wantsChart, sql: aiData.generated_sql });
      }

      if (['requires_confirmation', 'executed'].includes(aiData.status) && !queryText.toLowerCase().includes('select')) {
         setTimeout(() => { fetchTableList(); fetchAuditHistory(); }, 1000);
      }
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'system', error: 'Server connection failed.' }]);
    } finally {
      setLoading(false);
    }
  };

  const confirmExecution = async (sqlQuery) => {
    setLoading(true);
    try {
      await axios.post('http://localhost:8000/execute-confirmed-query', { sql_query: sqlQuery });
      setMessages((prev) => [...prev, { role: 'system', successMsg: "Update executed successfully!" }]);
      fetchTableList();
      fetchAuditHistory();
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'system', error: 'Execution failed.' }]);
    } finally {
      setLoading(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording && mediaRecorder) {
      mediaRecorder.stop();
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
          console.error(err);
        } finally {
          setLoading(false);
          setIsRecording(false);
          stream.getTracks().forEach(t => t.stop());
        }
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      alert("Mic access denied");
    }
  };

return (
  <div className="dashboard-container">
    {/* 1. LEFT SIDEBAR */}
    <div className="sidebar">
      <div className="sidebar-brand">
        <Database size={20} color="#60a5fa" />
        <span>DataQuery Pro</span>
      </div>
      
      <div className="upload-section">
        <label className="upload-button">
          <UploadCloud size={16} />
          <span>Import CSV</span>
          <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
        </label>
      </div>

      <div className="sidebar-label">Registered Tables</div>
      <div className="table-list">
        {tables.map((table) => (
          <div 
            key={table} 
            className={`table-item ${activeTable === table ? 'active' : ''}`}
            onClick={() => setActiveTable(table)}
          >
            <div className="table-info">
              <FileText size={14} className="table-icon" />
              <span>{table}</span>
            </div>
            <div className="table-actions">
              <Download 
                size={14} 
                className="action-icon download" 
                onClick={(e) => { e.stopPropagation(); handleDownloadTable(table); }} 
              />
              <Trash2 
                size={14} 
                className="action-icon delete" 
                onClick={(e) => { e.stopPropagation(); handleDeleteTable(table); }} 
              />
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* 2. MAIN CONSOLE */}
    <div className="main-content">
      <header className="main-header">
        <div className="header-context">
          <div className={`status-indicator ${activeTable ? 'table-mode' : 'global-mode'}`} />
          <div>
            <h1>Analytics Console</h1>
            <p>{activeTable ? `Isolated Scope: ${activeTable}` : 'Global Database Scope'}</p>
          </div>
        </div>
        <div className="header-actions">
          {activeTable && (
            <button className="ghost-btn" onClick={() => setActiveTable(null)}>
              <Globe size={14} /> Global View
            </button>
          )}
          <button className={`ghost-btn ${showHistory ? 'active' : ''}`} onClick={() => setShowHistory(!showHistory)}>
            <History size={14} /> {showHistory ? 'Hide Logs' : 'Audit Logs'}
          </button>
        </div>
      </header>

      <div className="workspace-split">
        <div className="chat-container">
          <div className="messages-area">
            {messages.length === 0 && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <Database size={40} style={{ marginBottom: '10px', opacity: 0.2 }} />
                <p>Welcome. Import a CSV or ask a question to begin.</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message-wrapper ${msg.role}`}>
                <div className="message-bubble">
                  {msg.content && <p>{msg.content}</p>}
                  
                  {msg.data && (
                    <div className="ai-response-meta">
                      {msg.data.summary && <p className="summary">{msg.data.summary}</p>}
                      
                      <div className="sql-box">
                        <code>{msg.data.generated_sql}</code>
                      </div>

                      {/* CONFIRMATION BOX FOR DESTRUCTIVE QUERIES */}
                      {msg.data.status === 'requires_confirmation' && (
                        <div className="confirmation-box">
                          <p style={{ color: '#f87171', margin: '0 0 8px 0', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <AlertCircle size={14} /> 
                            {msg.data.warning}
                          </p>
                          <button 
                            className="confirm-btn"
                            onClick={() => confirmExecution(msg.data.generated_sql)}
                          >
                            Confirm and Execute
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {msg.successMsg && <div style={{ color: 'var(--success)', fontSize: '13px', marginTop: '5px' }}>✓ {msg.successMsg}</div>}
                  {msg.error && <div className="error-alert" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--error)', marginTop: '5px' }}><AlertCircle size={14}/> {msg.error}</div>}
                </div>
              </div>
            ))}

            {/* PROCESSING / LOADING INDICATOR */}
            {loading && (
              <div className="message-wrapper system">
                <div className="processing-indicator">
                  <Loader2 className="spinner" size={18} />
                  <span>AI is analyzing the database...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="input-bar" onSubmit={(e) => { e.preventDefault(); performSearch(input); setInput(''); }}>
            <button type="button" className={`icon-btn ${isRecording ? 'recording' : ''}`} onClick={toggleRecording}>
              {isRecording ? <Square size={18} fill="#ef4444" /> : <Mic size={18} />}
            </button>
            <input 
              type="text" 
              value={input} 
              onChange={(e) => setInput(e.target.value)}
              placeholder={activeTable ? `Query ${activeTable}...` : "Ask about your data..."} 
            />
            <button type="submit" className="send-btn" disabled={!input.trim() || loading}>
              <Send size={18} />
            </button>
          </form>
        </div>

        {currentData && (
          <div className="data-preview-panel">
            <div className="panel-header">
              <div className="tab active">Results Preview</div>
              <div className="sql-reference">{currentData.sql}</div>
            </div>
            <div className="panel-body">
              {currentData.wantsChart ? (
                <div style={{ height: '100%', minHeight: '250px' }}>
                  <DynamicChart data={currentData.rows} />
                </div>
              ) : (
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>{Object.keys(currentData.rows[0]).map(k => <th key={k}>{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      {currentData.rows.map((row, i) => (
                        <tr key={i}>{Object.values(row).map((v, j) => <td key={j}>{v}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* 3. AUDIT LOG DRAWER */}
    {showHistory && (
      <aside className="audit-drawer">
        <div className="drawer-header">Transaction History</div>
        <div className="log-list">
          {auditLog.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>No logs recorded yet.</div>
          ) : (
            auditLog.map((log) => (
              <div key={log.id} className="log-entry">
                <div className="log-tag">{log.action_type}</div>
                <div className="log-table">Table: {log.table_affected}</div>
                <div className="log-sql">{log.query_executed}</div>
                <div className="log-time">{new Date(log.timestamp).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      </aside>
    )}
  </div>
);
}

export default App;