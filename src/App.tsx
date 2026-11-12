import { useEffect, useState, useRef } from 'react';
import { socket } from './socket';

interface User {
  _id: string;
  name: string;
  role: string;
  phone: string;
}

interface Message {
  _id?: string;
  senderId: string;
  content: string;
  createdAt?: string; 
}

// Valid 24-character hexadecimal strings required for MongoDB ObjectIds
const MOCK_COMMUNITY_ROOM = '651f8a700000000000000001';
const MOCK_PERSONAL_ROOM = '651f8a700000000000000002';

export default function App() {
  // Authentication State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentRoom, setCurrentRoom] = useState(MOCK_COMMUNITY_ROOM);
  const [typingStatus, setTypingStatus] = useState<string | null>(null);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    
    try {
      const response = await fetch('http://localhost:5001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setToken(data.token);
        setCurrentUser(data.user);
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (error) {
      setLoginError('Network error. Is the backend running?');
    }
  };

  useEffect(() => {
    // Only connect and fetch if the user is actually logged in and has a token
    if (!currentUser || !token) return;

    // Attach the token and manually connect the socket
    socket.auth = { token };
    socket.connect();

    const fetchHistory = async () => {
      try {
        const response = await fetch(`http://localhost:5001/api/messages/${currentRoom}`);
        if (response.ok) {
          const data = await response.json();
          setMessages(data); 
        }
      } catch (error) {
        console.error('Failed to fetch message history:', error);
      }
    };

    fetchHistory();

    // Join room using the real database user ID
    socket.emit('join_room', { roomId: currentRoom, userId: currentUser._id });

    socket.on('receive_message', (newMessage: Message) => {
      setMessages((prev) => [...prev, newMessage]);
    });

    socket.on('display_typing', (data: { userName?: string; isTyping: boolean }) => {
      if (data.isTyping && data.userName) {
        setTypingStatus(`${data.userName} is typing...`);
      } else {
        setTypingStatus(null);
      }
    });

    return () => {
      socket.off('receive_message');
      socket.off('display_typing');
      socket.disconnect(); // Disconnect when logging out or unmounting
    };
  }, [currentRoom, currentUser, token]);

  const handleSendMessage = () => {
    if (!input.trim() || !currentUser) return;

    socket.emit('send_message', {
      roomId: currentRoom,
      senderId: currentUser._id, 
      content: input,
    });

    setInput('');
    socket.emit('stop_typing', { roomId: currentRoom });
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (!currentUser) return;

    socket.emit('typing', { roomId: currentRoom, userName: currentUser.name });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { roomId: currentRoom });
    }, 1500);
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const dateString = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateString}, ${timeString}`;
  };

  if (!currentUser || !token) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#ecf0f1', fontFamily: 'sans-serif' }}>
        <form onSubmit={handleLogin} style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '1rem', width: '300px' }}>
          <h2 style={{ margin: 0, textAlign: 'center', color: '#2c3e50' }}>Manager Login</h2>
          {loginError && <div style={{ color: '#e74c3c', fontSize: '0.9rem', textAlign: 'center' }}>{loginError}</div>}
          
          <input
            type="tel"
            placeholder="Phone Number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            required
          />
          <button
            type="submit"
            style={{ padding: '10px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Log In
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* Sidebar Navigation */}
      <div style={{ width: '250px', background: '#2c3e50', color: 'white', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
        <h2>Fleet Manager</h2>
        <div style={{ fontSize: '0.9rem', color: '#bdc3c7', marginBottom: '1rem' }}>Welcome, {currentUser.name}</div>
        
        <ul style={{ listStyle: 'none', padding: 0, flex: 1 }}>
          <li
            onClick={() => {
              setMessages([]);
              setCurrentRoom(MOCK_COMMUNITY_ROOM);
            }}
            style={{
              padding: '10px',
              cursor: 'pointer',
              borderRadius: '4px',
              background: currentRoom === MOCK_COMMUNITY_ROOM ? '#34495e' : 'transparent',
            }}
          >
            Community Hub
          </li>
          <li
            onClick={() => {
              setMessages([]);
              setCurrentRoom(MOCK_PERSONAL_ROOM);
            }}
            style={{
              padding: '10px',
              cursor: 'pointer',
              borderRadius: '4px',
              marginTop: '5px',
              background: currentRoom === MOCK_PERSONAL_ROOM ? '#34495e' : 'transparent',
            }}
          >
            Driver 1 (Personal)
          </li>
        </ul>

        <button 
          onClick={() => { setCurrentUser(null); setToken(null); }}
          style={{ padding: '10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Log Out
        </button>
      </div>

      {/* Main Chat Interface */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem' }}>
        <h3>Active Room: {currentRoom === MOCK_COMMUNITY_ROOM ? 'Community Hub' : 'Driver 1 Personal'}</h3>

        <div style={{ flex: 1, border: '1px solid #ccc', padding: '1rem', overflowY: 'auto', marginBottom: '1rem', borderRadius: '4px' }}>
          {messages.map((msg, idx) => {
            const isMe = msg.senderId === currentUser._id; 
            return (
              <div key={idx} style={{ marginBottom: '10px', textAlign: isMe ? 'right' : 'left' }}>
                <div style={{ display: 'inline-block', maxWidth: '60%', textAlign: isMe ? 'right' : 'left' }}>
                  <span
                    style={{
                      background: isMe ? '#3498db' : '#ecf0f1',
                      color: isMe ? 'white' : 'black',
                      padding: '8px 12px',
                      borderRadius: '15px',
                      display: 'inline-block',
                      wordBreak: 'break-word',
                      textAlign: 'left'
                    }}
                  >
                    {msg.content}
                  </span>
                  <div style={{ fontSize: '0.7rem', color: '#95a5a6', marginTop: '4px', marginRight: '4px', marginLeft: '4px' }}>
                    {formatTime(msg.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
          
          {typingStatus && (
            <div style={{ fontSize: '0.8rem', color: '#7f8c8d', fontStyle: 'italic', marginTop: '5px' }}>
              {typingStatus}
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={input}
            onChange={handleTyping}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            placeholder="Type a message..."
          />
          <button
            onClick={handleSendMessage}
            style={{ padding: '10px 20px', background: '#2ecc71', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}