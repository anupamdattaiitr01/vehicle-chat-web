import { useEffect, useState, useRef } from 'react';
import { socket } from './socket';

interface Message {
  _id?: string;
  senderId: string;
  content: string;
}

// Valid 24-character hexadecimal strings required for MongoDB ObjectIds
const MOCK_COMMUNITY_ROOM = '651f8a700000000000000001';
const MOCK_PERSONAL_ROOM = '651f8a700000000000000002';
const MANAGER_ID = '651f8a700000000000000003';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentRoom, setCurrentRoom] = useState(MOCK_COMMUNITY_ROOM);
  const [typingStatus, setTypingStatus] = useState<string | null>(null);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 1. Fetch historical messages from the new REST API
    const fetchHistory = async () => {
      try {
        const response = await fetch(`http://localhost:5001/api/messages/${currentRoom}`);
        if (response.ok) {
          const data = await response.json();
          setMessages(data); // Hydrate the screen with past messages
        }
      } catch (error) {
        console.error('Failed to fetch message history:', error);
      }
    };

    fetchHistory();

    // 2. Join the active room
    socket.emit('join_room', { roomId: currentRoom, userId: MANAGER_ID });

    // 3. Listen for incoming messages
    socket.on('receive_message', (newMessage: Message) => {
      setMessages((prev) => [...prev, newMessage]);
    });

    // 4. Listen for typing indicators from drivers
    socket.on('display_typing', (data: { userName?: string; isTyping: boolean }) => {
      if (data.isTyping && data.userName) {
        setTypingStatus(`${data.userName} is typing...`);
      } else {
        setTypingStatus(null);
      }
    });

    // Cleanup socket event listeners on room change or unmount
    return () => {
      socket.off('receive_message');
      socket.off('display_typing');
    };
  }, [currentRoom]);

  const handleSendMessage = () => {
    if (!input.trim()) return;

    socket.emit('send_message', {
      roomId: currentRoom,
      senderId: MANAGER_ID,
      content: input,
    });

    setInput('');
    socket.emit('stop_typing', { roomId: currentRoom });
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);

    socket.emit('typing', { roomId: currentRoom, userName: 'Manager' });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    // Stop typing indicator 1.5s after the last keystroke
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { roomId: currentRoom });
    }, 1500);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* Sidebar Navigation */}
      <div style={{ width: '250px', background: '#2c3e50', color: 'white', padding: '1rem' }}>
        <h2>Fleet Manager</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
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
      </div>

      {/* Main Chat Interface */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem' }}>
        <h3>Active Room: {currentRoom === MOCK_COMMUNITY_ROOM ? 'Community Hub' : 'Driver 1 Personal'}</h3>

        {/* Message Container */}
        <div style={{ flex: 1, border: '1px solid #ccc', padding: '1rem', overflowY: 'auto', marginBottom: '1rem', borderRadius: '4px' }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{ marginBottom: '10px', textAlign: msg.senderId === MANAGER_ID ? 'right' : 'left' }}>
              <span
                style={{
                  background: msg.senderId === MANAGER_ID ? '#3498db' : '#ecf0f1',
                  color: msg.senderId === MANAGER_ID ? 'white' : 'black',
                  padding: '8px 12px',
                  borderRadius: '15px',
                  display: 'inline-block',
                  maxWidth: '60%',
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
              </span>
            </div>
          ))}
          {typingStatus && (
            <div style={{ fontSize: '0.8rem', color: '#7f8c8d', fontStyle: 'italic', marginTop: '5px' }}>
              {typingStatus}
            </div>
          )}
        </div>

        {/* Input Bar */}
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