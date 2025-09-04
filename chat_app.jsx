import { useEffect, useState, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, query, addDoc, serverTimestamp, doc, setDoc, getDoc } from 'firebase/firestore';
import { useSignals, signal, computed } from '@preact/signals-react';

// Use provided global variables for Firebase configuration
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : undefined;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Use signals for state management
const chatRoomId = signal('');
const messages = signal([]);
const newMessageText = signal('');
const authUser = signal(null);
const isAuthReady = signal(false);
const isChatReady = signal(false);
const showHelpModal = signal(true);
const modalInput = signal('');

const App = () => {
  useSignals();
  const messagesEndRef = useRef(null);

  // Computed signal for a trimmed message
  const trimmedMessageText = computed(() => newMessageText.value.trim());

  // Firestore path for messages
  const getMessagesCollectionPath = () => {
    return `/artifacts/${appId}/public/data/chats/${chatRoomId.value}/messages`;
  };

  // Auto-scroll to the bottom of the message list
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // Authenticate the user and set up the auth state listener
    const unsubscribeAuth = auth.onAuthStateChanged(user => {
      if (user) {
        authUser.value = user;
      } else {
        // If the custom token is not available, sign in anonymously
        signInAnonymously(auth).then(anonUserCredential => {
          authUser.value = anonUserCredential.user;
        }).catch(error => {
          console.error("Anonymous sign-in failed", error);
        });
      }
      isAuthReady.value = true;
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    // Only set up the Firestore listener if auth is ready and a chat room is selected
    if (isAuthReady.value && chatRoomId.value) {
      const messagesRef = collection(db, getMessagesCollectionPath());
      const q = query(messagesRef);

      const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const fetchedMessages = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id,
          createdAt: doc.data().createdAt?.toDate() // Convert Firestore Timestamp to Date
        }));
        // Sort messages by timestamp
        fetchedMessages.sort((a, b) => a.createdAt - b.createdAt);
        messages.value = fetchedMessages;
        scrollToBottom();
      }, (error) => {
        console.error("Error fetching messages:", error);
      });

      isChatReady.value = true;
      return () => unsubscribeSnapshot();
    }
  }, [isAuthReady.value, chatRoomId.value]);

  const handleSendMessage = async () => {
    if (trimmedMessageText.value.length === 0 || !isChatReady.value) {
      return;
    }

    const message = {
      text: trimmedMessageText.value,
      senderId: authUser.value.uid,
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, getMessagesCollectionPath()), message);
      newMessageText.value = '';
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const createNewChat = async () => {
    const newChatId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const chatDocRef = doc(db, `/artifacts/${appId}/public/data/chats/${newChatId}`);
    try {
      await setDoc(chatDocRef, {
        creatorId: authUser.value.uid,
        createdAt: serverTimestamp(),
      });
      chatRoomId.value = newChatId;
      showHelpModal.value = false;
    } catch (error) {
      console.error("Error creating new chat:", error);
    }
  };

  const joinExistingChat = async () => {
    if (modalInput.value.length > 0) {
      const chatDocRef = doc(db, `/artifacts/${appId}/public/data/chats/${modalInput.value}`);
      try {
        const docSnap = await getDoc(chatDocRef);
        if (docSnap.exists()) {
          chatRoomId.value = modalInput.value;
          showHelpModal.value = false;
        } else {
          console.error("Chat room not found.");
        }
      } catch (error) {
        console.error("Error joining chat:", error);
      }
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  const isMyMessage = (message) => message.senderId === authUser.value?.uid;

  const formatDate = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-screen font-sans bg-pink-50 p-4 antialiased">
      <div className="flex flex-col h-full w-full max-w-lg mx-auto bg-white rounded-3xl shadow-xl overflow-hidden transform transition-all duration-300">
        <header className="bg-pink-500 text-white p-4 flex justify-between items-center shadow-md">
          <h1 className="text-2xl font-bold tracking-tight">Lovebirds Chat</h1>
          <div className="text-sm font-medium opacity-80">
            {chatRoomId.value ? `Room: ${chatRoomId.value}` : 'Offline'}
          </div>
        </header>

        <main className="flex-1 p-4 overflow-y-auto space-y-4 custom-scrollbar">
          {!isChatReady.value ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4 text-pink-300" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314"/>
              </svg>
              <h2 className="text-xl font-semibold mb-2">Welcome to your private chat.</h2>
              <p>To get started, please either create a new room or join an existing one.</p>
              <button
                onClick={() => showHelpModal.value = true}
                className="mt-4 px-6 py-2 bg-pink-500 text-white rounded-full font-semibold shadow-lg hover:bg-pink-600 transition-colors"
              >
                Get Started
              </button>
            </div>
          ) : (
            messages.value.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${isMyMessage(msg) ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] p-3 rounded-2xl shadow-sm transform transition-transform duration-200 ease-out ${
                    isMyMessage(msg)
                      ? 'bg-pink-500 text-white rounded-br-none'
                      : 'bg-gray-100 text-gray-800 rounded-bl-none'
                  }`}
                >
                  <p className="text-sm break-words">{msg.text}</p>
                  <span className={`block text-right mt-1 text-xs opacity-70 ${isMyMessage(msg) ? 'text-pink-100' : 'text-gray-500'}`}>
                    {formatDate(msg.createdAt)}
                  </span>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </main>

        <footer className="p-4 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={newMessageText.value}
              onChange={(e) => newMessageText.value = e.target.value}
              onKeyPress={handleKeyPress}
              placeholder="Send a message..."
              className="flex-1 p-3 text-sm rounded-full bg-white border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all"
              disabled={!isChatReady.value}
            />
            <button
              onClick={handleSendMessage}
              className={`px-4 py-3 rounded-full transition-colors duration-200 transform hover:scale-105 shadow-md ${
                !trimmedMessageText.value || !isChatReady.value
                  ? 'bg-pink-200 text-pink-400 cursor-not-allowed'
                  : 'bg-pink-500 text-white'
              }`}
              disabled={!trimmedMessageText.value || !isChatReady.value}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l.66-2.883a1 1 0 01.18-.707l.228-.227a1 1 0 01.17-.112l4.135-2.617a1 1 0 00.17-.112l4.136-2.617a1 1 0 00.17-.112l.228-.227a1 1 0 01.18-.707l.66-2.883a1 1 0 001.169 1.409l-7-14z"/>
              </svg>
            </button>
          </div>
        </footer>
      </div>

      {showHelpModal.value && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md transform scale-100 opacity-100 transition-all duration-300">
            <h2 className="text-2xl font-bold text-center mb-4">Start Your Chat</h2>
            <p className="text-center text-gray-600 mb-6">
              You can either create a new private room or join an existing one.
            </p>
            <div className="space-y-4">
              <button
                onClick={createNewChat}
                className="w-full py-4 text-lg font-semibold text-white bg-pink-500 rounded-2xl shadow-lg hover:bg-pink-600 transition-colors"
              >
                Create New Chat
              </button>
              <div className="flex items-center my-4">
                <hr className="flex-1 border-gray-300" />
                <span className="px-3 text-gray-500">OR</span>
                <hr className="flex-1 border-gray-300" />
              </div>
              <div>
                <input
                  type="text"
                  value={modalInput.value}
                  onChange={(e) => modalInput.value = e.target.value.toUpperCase()}
                  placeholder="Enter Room ID"
                  className="w-full p-3 text-center text-lg rounded-2xl border-2 border-pink-200 focus:outline-none focus:border-pink-500 transition-colors"
                />
                <button
                  onClick={joinExistingChat}
                  className="w-full mt-2 py-4 text-lg font-semibold text-pink-500 bg-white border-2 border-pink-500 rounded-2xl shadow-lg hover:bg-pink-50 transition-colors"
                >
                  Join Existing Chat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

