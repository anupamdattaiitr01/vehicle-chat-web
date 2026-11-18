import { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from './socket';
import CryptoJS from 'crypto-js'; // For payload encryption

interface User {
  _id: string;
  name: string;
  role: string;
  phone: string;
}

interface DriverRoom {
  driverId: string;
  driverName: string;
  driverPhone: string;
  roomId: string;
}

interface Message {
  _id?: string;
  roomId?: string;
  senderId: string;
  content: string;
  createdAt?: string;
}

// Shared secret key for AES encryption (must match the backend)
const ENCRYPTION_KEY = 'fleet_payload_secret_2026';

export default function App() {
  // Authentication & Registration State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  // Dynamic Room State
  const [communityRoomId, setCommunityRoomId] = useState<string>('');
  const [driverRooms, setDriverRooms] = useState<DriverRoom[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('');
  const [loadingRooms, setLoadingRooms] = useState(false);

  // Add Driver Modal State
  const [isAddDriverOpen, setIsAddDriverOpen] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverPassword, setDriverPassword] = useState('');
  const [showDriverPassword, setShowDriverPassword] = useState(false);
  const [addingDriver, setAddingDriver] = useState(false);
  const [addDriverError, setAddDriverError] = useState('');

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typingStatus, setTypingStatus] = useState<string | null>(null);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // Track the active room in a ref so incoming socket events only append to the active room
  const activeRoomRef = useRef<string>('');

  useEffect(() => {
    activeRoomRef.current = currentRoom;
  }, [currentRoom]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch dynamic rooms (Community Hub + all drivers assigned to this manager)
  const fetchMyRooms = useCallback(async (authToken: string) => {
    setLoadingRooms(true);
    try {
      const response = await fetch('http://localhost:5001/api/rooms/my-rooms', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCommunityRoomId(data.communityRoomId || '');
        setDriverRooms(data.drivers || []);

        // Default to Community Hub on initial login
        setCurrentRoom((prev) => prev || data.communityRoomId || '');
      }
    } catch (error) {
      console.error('Failed to fetch assigned rooms:', error);
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  // Handle both Manager Login and Manager Registration with AES encryption
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');

    try {
      if (isRegisterMode) {
        // 1. Encrypt Manager registration details
        const rawPayload = JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          password,
          role: 'manager',
        });
        const encryptedPayload = CryptoJS.AES.encrypt(rawPayload, ENCRYPTION_KEY).toString();

        const response = await fetch('http://localhost:5001/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: encryptedPayload }),
        });

        const data = await response.json();

        if (response.ok) {
          setAuthSuccess('Manager registered successfully! Please log in.');
          setPassword('');
          setIsRegisterMode(false); // Keep phone number pre-filled for immediate login
        } else {
          setAuthError(data.error || 'Registration failed');
        }
      } else {
        // 2. Encrypt Manager login credentials
        const rawPayload = JSON.stringify({
          phone: phone.trim(),
          password,
        });
        const encryptedPayload = CryptoJS.AES.encrypt(rawPayload, ENCRYPTION_KEY).toString();

        const response = await fetch('http://localhost:5001/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: encryptedPayload }),
        });

        const data = await response.json();

        if (response.ok) {
          if (data.user.role !== 'manager') {
            setAuthError('Access denied: This dashboard is for Managers only.');
            return;
          }
          setToken(data.token);
          setCurrentUser(data.user);
        } else {
          setAuthError(data.error || 'Login failed');
        }
      }
    } catch {
      setAuthError('Network error. Is the backend running?');
    }
  };

  // Provision a new driver under the logged-in Manager
  const handleAddDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setAddDriverError('');

    if (!driverName.trim() || !driverPhone.trim() || !driverPassword.trim()) {
      setAddDriverError('Driver name, phone number, and password are required.');
      return;
    }

    setAddingDriver(true);
    try {
      const rawPayload = JSON.stringify({
        name: driverName.trim(),
        phone: driverPhone.trim(),
        password: driverPassword.trim(),
      });
      const encryptedPayload = CryptoJS.AES.encrypt(rawPayload, ENCRYPTION_KEY).toString();

      const response = await fetch('http://localhost:5001/api/rooms/add-driver', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ data: encryptedPayload }),
      });

      const data = await response.json();

      if (response.ok) {
        await fetchMyRooms(token);
        if (data.driver?.roomId) {
          setMessages([]);
          setCurrentRoom(data.driver.roomId);
        }
        closeAddDriverModal();
      } else {
        setAddDriverError(data.error || 'Failed to add driver.');
      }
    } catch {
      setAddDriverError('Network error. Is the backend running?');
    } finally {
      setAddingDriver(false);
    }
  };

  const openAddDriverModal = () => {
    setDriverName('');
    setDriverPhone('');
    setDriverPassword('');
    setShowDriverPassword(false);
    setAddDriverError('');
    setIsAddDriverOpen(true);
  };

  const closeAddDriverModal = () => {
    if (addingDriver) return;
    setIsAddDriverOpen(false);
    setDriverName('');
    setDriverPhone('');
    setDriverPassword('');
    setShowDriverPassword(false);
    setAddDriverError('');
  };

  // Connect authenticated socket and load manager's rooms once logged in
  useEffect(() => {
    if (!currentUser || !token) return;

    fetchMyRooms(token);

    socket.auth = { token };
    socket.connect();

    socket.on('receive_message', (newMessage: Message) => {
      // Only append if the message belongs to the currently open room
      if (!newMessage.roomId || newMessage.roomId === activeRoomRef.current) {
        setMessages((prev) => [...prev, newMessage]);
      }
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
      socket.disconnect();
    };
  }, [currentUser, token, fetchMyRooms]);

  // Fetch message history and join socket room whenever currentRoom changes
  useEffect(() => {
    if (!currentUser || !token || !currentRoom) return;

    setTypingStatus(null);

    const fetchHistory = async () => {
      try {
        const response = await fetch(`http://localhost:5001/api/messages/${currentRoom}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setMessages(data);
        }
      } catch (error) {
        console.error('Failed to fetch message history:', error);
      }
    };

    fetchHistory();
    socket.emit('join_room', { roomId: currentRoom, userId: currentUser._id });
  }, [currentRoom, currentUser, token]);

  const handleSendMessage = () => {
    if (!input.trim() || !currentUser || !currentRoom) return;

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
    if (!currentUser || !currentRoom) return;

    socket.emit('typing', { roomId: currentRoom, userName: currentUser.name });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { roomId: currentRoom });
    }, 1500);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setToken(null);
    setCommunityRoomId('');
    setDriverRooms([]);
    setCurrentRoom('');
    setMessages([]);
    setPassword('');
    setIsAddDriverOpen(false);
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const dateString = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateString}, ${timeString}`;
  };

  // Determine the title of the active room for the header
  const getActiveRoomTitle = () => {
    if (!currentRoom) return 'Loading...';
    if (currentRoom === communityRoomId) return 'Community Hub (All Drivers & Managers)';
    const selectedDriver = driverRooms.find((d) => d.roomId === currentRoom);
    return selectedDriver
      ? `${selectedDriver.driverName} (${selectedDriver.driverPhone})`
      : 'Personal Chat';
  };

  // Auth Screen (Manager Login / Register Toggle)
  if (!currentUser || !token) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#ecf0f1', fontFamily: 'sans-serif' }}>
        <form
          onSubmit={handleAuthSubmit}
          style={{
            background: 'white',
            padding: '2rem',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            width: '340px',
          }}
        >
          <h2 style={{ margin: 0, textAlign: 'center', color: '#2c3e50' }}>
            {isRegisterMode ? 'Manager Registration' : 'Manager Login'}
          </h2>

          {authError && (
            <div style={{ color: '#e74c3c', fontSize: '0.85rem', textAlign: 'center', background: '#fdecea', padding: '8px', borderRadius: '4px' }}>
              {authError}
            </div>
          )}

          {authSuccess && (
            <div style={{ color: '#27ae60', fontSize: '0.85rem', textAlign: 'center', background: '#eafaf1', padding: '8px', borderRadius: '4px' }}>
              {authSuccess}
            </div>
          )}

          {isRegisterMode && (
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              required
            />
          )}

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

          {isRegisterMode && (
            <div style={{ fontSize: '0.85rem', color: '#7f8c8d', background: '#f8f9fa', padding: '8px', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
              Role: <strong>Manager</strong>
            </div>
          )}

          <button
            type="submit"
            style={{ padding: '10px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {isRegisterMode ? 'Register as Manager' : 'Log In'}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsRegisterMode(!isRegisterMode);
              setAuthError('');
              setAuthSuccess('');
            }}
            style={{ background: 'transparent', border: 'none', color: '#3498db', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
          >
            {isRegisterMode ? 'Already registered? Log In' : 'New Manager? Register here'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', position: 'relative' }}>
      {/* Dynamic Sidebar Navigation */}
      <div style={{ width: '280px', background: '#2c3e50', color: 'white', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: '4px' }}>Fleet Manager</h2>
        <div style={{ fontSize: '0.85rem', color: '#bdc3c7', marginBottom: '1.25rem' }}>
          {currentUser.name} ({currentUser.phone})
        </div>

        <ul style={{ listStyle: 'none', padding: 0, flex: 1, overflowY: 'auto' }}>
          {/* Shared Community Room */}
          <li
            onClick={() => {
              if (currentRoom !== communityRoomId) {
                setMessages([]);
                setCurrentRoom(communityRoomId);
              }
            }}
            style={{
              padding: '10px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: 'bold',
              background: currentRoom === communityRoomId ? '#34495e' : 'transparent',
            }}
          >
            Community Hub
          </li>

          {/* Assigned Drivers Header + Add Driver & Refresh Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '18px', marginBottom: '8px', padding: '0 4px', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#95a5a6' }}>
              My Drivers ({driverRooms.length})
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={openAddDriverModal}
                style={{
                  background: '#27ae60',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                + Add Driver
              </button>
              <button
                type="button"
                onClick={() => fetchMyRooms(token)}
                disabled={loadingRooms}
                style={{
                  background: '#34495e',
                  color: '#ecf0f1',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {loadingRooms ? '...' : 'Refresh'}
              </button>
            </div>
          </div>

          {driverRooms.length === 0 ? (
            <li style={{ fontSize: '0.8rem', color: '#95a5a6', padding: '8px 4px', fontStyle: 'italic' }}>
              No drivers assigned yet. Click "+ Add Driver" to register one.
            </li>
          ) : (
            driverRooms.map((driver) => (
              <li
                key={driver.driverId}
                onClick={() => {
                  if (currentRoom !== driver.roomId) {
                    setMessages([]);
                    setCurrentRoom(driver.roomId);
                  }
                }}
                style={{
                  padding: '10px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  marginTop: '4px',
                  background: currentRoom === driver.roomId ? '#34495e' : 'transparent',
                }}
              >
                <div style={{ fontWeight: 500 }}>{driver.driverName}</div>
                <div style={{ fontSize: '0.75rem', color: '#bdc3c7' }}>{driver.driverPhone}</div>
              </li>
            ))
          )}
        </ul>

        <button
          onClick={handleLogout}
          style={{ padding: '10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '10px' }}
        >
          Log Out
        </button>
      </div>

      {/* Main Chat Interface */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem' }}>
        <h3>Active Room: {getActiveRoomTitle()}</h3>

        <div style={{ flex: 1, border: '1px solid #ccc', padding: '1rem', overflowY: 'auto', marginBottom: '1rem', borderRadius: '4px' }}>
          {messages.map((msg, idx) => {
            const isMe = msg.senderId === currentUser._id;
            return (
              <div key={msg._id || idx} style={{ marginBottom: '10px', textAlign: isMe ? 'right' : 'left' }}>
                <div style={{ display: 'inline-block', maxWidth: '60%', textAlign: isMe ? 'right' : 'left' }}>
                  <span
                    style={{
                      background: isMe ? '#3498db' : '#ecf0f1',
                      color: isMe ? 'white' : 'black',
                      padding: '8px 12px',
                      borderRadius: '15px',
                      display: 'inline-block',
                      wordBreak: 'break-word',
                      textAlign: 'left',
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

      {/* Add Driver Modal */}
      {isAddDriverOpen && (
        <div
          onClick={closeAddDriverModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={handleAddDriverSubmit}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              padding: '1.75rem',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
              width: '360px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.9rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#2c3e50' }}>Add Driver to Fleet</h3>
              <button
                type="button"
                onClick={closeAddDriverModal}
                disabled={addingDriver}
                style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#7f8c8d' }}
              >
                ×
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '0.82rem', color: '#7f8c8d' }}>
              Create login credentials for your driver. Share the phone number and password with them to sign in on the mobile app.
            </p>

            {addDriverError && (
              <div style={{ color: '#e74c3c', fontSize: '0.85rem', background: '#fdecea', padding: '8px 10px', borderRadius: '4px' }}>
                {addDriverError}
              </div>
            )}

            <input
              type="text"
              placeholder="Driver Full Name"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              required
            />

            <input
              type="tel"
              placeholder="Driver Phone Number"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              required
            />

            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type={showDriverPassword ? 'text' : 'password'}
                placeholder="Assign Login Password"
                value={driverPassword}
                onChange={(e) => setDriverPassword(e.target.value)}
                style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
                required
              />
              <button
                type="button"
                onClick={() => setShowDriverPassword((prev) => !prev)}
                style={{
                  padding: '0 10px',
                  background: '#ecf0f1',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  color: '#2c3e50',
                }}
              >
                {showDriverPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={closeAddDriverModal}
                disabled={addingDriver}
                style={{
                  padding: '9px 14px',
                  background: '#ecf0f1',
                  color: '#2c3e50',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addingDriver}
                style={{
                  padding: '9px 16px',
                  background: '#27ae60',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                {addingDriver ? 'Adding...' : 'Create & Assign Driver'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}