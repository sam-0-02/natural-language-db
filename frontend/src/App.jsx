import { useState } from 'react'
import axios from 'axios'
import DynamicChart from './DynamicChart' 

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)

  // --- REUSABLE SEARCH LOGIC ---
  const performSearch = async (queryText) => {
    if (!queryText.trim()) return

    const wantsChart = /chart|graph|plot/i.test(queryText)
    
    // Add user message to UI immediately
    setMessages((prev) => [...prev, { role: 'user', content: queryText }])
    setLoading(true)

    try {
      const response = await axios.post('http://localhost:8000/generate-query', {
        user_prompt: queryText
      })

      setMessages((prev) => [...prev, { 
        role: 'system', 
        data: response.data,
        wantsChart: wantsChart 
      }])
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'system', error: 'Failed to connect to the server.' }])
    } finally {
      setLoading(false)
    }
  }

  // --- VOICE LOGIC ---
  const toggleRecording = async () => {
  // If we are already recording, stop it
  if (isRecording) {
    if (mediaRecorder) {
      mediaRecorder.stop();
    }
    return;
  }

  // If we are NOT recording, start it
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
        const transcribedText = res.data.transcription;
        
        setInput(transcribedText); 
        await performSearch(transcribedText);

      } catch (err) {
        console.error("Transcription failed", err);
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
    console.error("Microphone access denied", err);
    alert("Please allow microphone access to use voice search.");
  }
};

  // --- FORM LOGIC ---
  const handleFormSubmit = (e) => {
    e.preventDefault()
    performSearch(input)
    setInput('')
  }

  const confirmExecution = async (sqlQuery) => {
    setLoading(true)
    try {
      const response = await axios.post('http://localhost:8000/execute-confirmed-query', {
        sql_query: sqlQuery
      })
      
      setMessages((prev) => [...prev, { 
        role: 'system', 
        successMsg: "Database updated successfully!", 
        data: response.data 
      }])
    } catch (error) {
       console.error(error)
       setMessages((prev) => [...prev, { role: 'system', error: 'Execution failed.' }])
    } finally {
      setLoading(false)
    }
  }

return (
  <div className="chat-container">
    <div className="chat-header">
      <h2 style={{ margin: 0 }}>Natural Language DB</h2>
      <span style={{ fontSize: '12px', color: '#94a3b8' }}>Connected: LM Studio (Local)</span>
    </div>

    <div className="messages-area">
      {messages.map((msg, index) => (
        <div key={index} className={`message ${msg.role === 'user' ? 'user-message' : 'ai-message'}`}>
          {msg.content && <div>{msg.content}</div>}
          
          {msg.error && <div style={{ color: '#f87171' }}>❌ {msg.error}</div>}
          {msg.successMsg && <div style={{ color: '#4ade80' }}>✅ {msg.successMsg}</div>}

          {msg.data && (
            <div style={{ marginTop: '10px' }}>
              {/* 1. Display the AI Summary */}
              {msg.data.summary && (
                <p style={{ margin: '0 0 10px 0', fontWeight: '500', color: '#e2e8f0' }}>
                  {msg.data.summary}
                </p>
              )}

              <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '8px' }}>
                SQL: <code>{msg.data.generated_sql || msg.data.executed_sql}</code>
              </div>

              {msg.data.status === 'requires_confirmation' && (
                <div style={{ background: 'rgba(248, 113, 113, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid #f87171' }}>
                  <p style={{ color: '#f87171', marginTop: 0 }}>{msg.data.warning}</p>
                  <button onClick={() => confirmExecution(msg.data.generated_sql)}>Confirm Execute</button>
                </div>
              )}

              {msg.data.data && msg.data.data.length > 0 && (
                <div style={{ marginTop: '15px' }}>
                  {msg.wantsChart && <DynamicChart data={msg.data.data} />}
                  
                  {/* 2. Professional Data Table */}
                  <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', marginTop: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: 'rgba(0,0,0,0.2)' }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          {Object.keys(msg.data.data[0]).map(key => (
                            <th key={key} style={{ textAlign: 'left', padding: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.data.data.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            {Object.values(row).map((val, j) => (
                              <td key={j} style={{ padding: '10px', color: '#f1f5f9' }}>{val}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {loading && <div className="message ai-message"><em>Analysing database...</em></div>}
    </div>

    <form onSubmit={handleFormSubmit} className="input-area">
      <input 
        type="text" 
        value={input} 
        onChange={(e) => setInput(e.target.value)} 
        placeholder="Ask for data or a chart..." 
      />
      <button 
        type="button" 
        onClick={toggleRecording}
        style={{ 
          background: isRecording ? '#ef4444' : '#334155', 
          minWidth: '80px',
          transition: 'all 0.3s ease'
        }}
      >
        {isRecording ? '⏹ Stop' : '🎤 Mic'}
      </button>
      <button type="submit" disabled={loading || isRecording}>Send</button>
    </form>
  </div>
);
}

export default App