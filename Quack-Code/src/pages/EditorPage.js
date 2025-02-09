// src/EditorPage.js
import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import ACTIONS from '../Actions';
import Client from '../components/Client';
import Editor from '../components/Editor';
import { initSocket } from '../socket';
import { useLocation, useNavigate, Navigate, useParams } from 'react-router-dom';

const EditorPage = () => {
  const socketRef = useRef(null);
  const codeRef = useRef('');
  const location = useLocation();
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);

  useEffect(() => {
    const init = async () => {
      socketRef.current = await initSocket();

      socketRef.current.on("connect_error", (err) => handleErrors(err));
      socketRef.current.on("connect_failed", (err) => handleErrors(err));

      function handleErrors(e) {
        console.error("socket error", e);
        toast.error("Socket connection failed, try again later.");
        navigate("/");
      }

      // Emit JOIN event when entering the room
      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: location.state?.username,
      });

      // Listen for JOINED event (which includes the updated client list)
      socketRef.current.on(
        ACTIONS.JOINED,
        ({ clients, username, socketId }) => {
          if (username !== location.state?.username) {
            toast.success(`${username} joined the room.`);
          }
          setClients(clients);
          socketRef.current.emit(ACTIONS.SYNC_CODE, {
            code: codeRef.current,
            socketId,
          });
        }
      );

      // Listen for CLIENTS_UPDATE event if sent by the server
      socketRef.current.on(ACTIONS.CLIENTS_UPDATE, ({ clients }) => {
        setClients(clients);
      });

      // Listen for DISCONNECTED events (user left)
      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        // Only show toast if the leaving user is not the current user
        if (username !== location.state?.username) {
          toast.success(`${username} left the room.`);
        }
        setClients(prev => prev.filter(client => client.socketId !== socketId));
      });
    };
    init();

    return () => {
      socketRef.current.disconnect();
      socketRef.current.off(ACTIONS.JOINED);
      socketRef.current.off(ACTIONS.CLIENTS_UPDATE);
      socketRef.current.off(ACTIONS.DISCONNECTED);
    };
  }, [location.state, navigate, roomId]);

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success("Room ID has been copied to your clipboard");
    } catch (err) {
      toast.error("Could not copy the Room ID");
      console.error(err);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(codeRef.current);
      toast.success("Code has been copied to your clipboard");
    } catch (err) {
      toast.error("Could not copy the Code");
      console.error(err);
    }
  }

  function leaveRoom() {
    // Emit the LEAVE event before navigating away
    socketRef.current.emit(ACTIONS.LEAVE, {
      roomId,
      username: location.state?.username,
    });
    toast.success("You left the room.");
    setTimeout(() => {
      navigate("/");
    }, 500);
  }

  if (!location.state) {
    return <Navigate to="/" />;
  }

  return (
    <div className="mainWrap">
      <div className="aside">
        <div className="asideInner">
          <div className="logo">
            <img className="logoImage" src="/code-sync.png" alt="logo" />
          </div>
          <h3>Connected</h3>
          <div className="clientsList">
            {clients.map((client) => (
              <Client 
                key={client.socketId} 
                username={client.username} 
                isCurrentUser={client.username === location.state?.username}
              />
            ))}
          </div>
        </div>
        <button className="btn copyBtn" onClick={copyRoomId}>
          Copy ROOM ID
        </button>
        <button className="btn copyBtn" onClick={copyCode}>
          Copy Code
        </button>
        <button className="btn leaveBtn" onClick={leaveRoom}>
          Leave
        </button>
      </div>
      <div className="editorWrap">
        <Editor
          socketRef={socketRef}
          roomId={roomId}
          username={location.state?.username}
          onCodeChange={(code) => {
            codeRef.current = code;
          }}
        />
      </div>
    </div>
  );
};

export default EditorPage;
