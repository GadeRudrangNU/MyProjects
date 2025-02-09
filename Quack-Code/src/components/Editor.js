// src/components/Editor.js
import React, { useEffect, useRef } from "react";
import Codemirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/dracula.css";
import "codemirror/mode/javascript/javascript";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";
import ACTIONS from "../Actions";

const Editor = ({ socketRef, roomId, onCodeChange, username }) => {
  const editorRef = useRef(null);
  // Keep track of remote cursor markers by socket ID
  const remoteCursorsRef = useRef({});

  // Helper: generate a consistent color based on the username
  const getColorForUser = (username) => {
    const colors = ["red", "blue", "green", "orange", "purple", "brown"];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  useEffect(() => {
    async function init() {
      editorRef.current = Codemirror.fromTextArea(
        document.getElementById("realtimeEditor"),
        {
          mode: { name: "javascript", json: true },
          theme: "dracula",
          autoCloseTags: true,
          autoCloseBrackets: true,
          lineNumbers: true,
        }
      );

      // Listen for changes and emit code updates
      editorRef.current.on("change", (instance, changes) => {
        const { origin } = changes;
        const code = instance.getValue();
        onCodeChange(code);
        if (origin !== "setValue") {
          socketRef.current.emit(ACTIONS.CODE_CHANGE, {
            roomId,
            code,
          });
        }
      });

      // Emit local cursor position changes
      editorRef.current.on("cursorActivity", () => {
        const cursor = editorRef.current.getCursor();
        socketRef.current.emit(ACTIONS.CURSOR_CHANGE, {
          roomId,
          cursor,
        });
      });
    }
    init();
  }, []);

  useEffect(() => {
    if (socketRef.current) {
      // Listen for code changes from others
      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ code }) => {
        if (code !== null) {
          editorRef.current.setValue(code);
        }
      });

      // Listen for remote cursor changes and create a mark container
      socketRef.current.on(
        ACTIONS.CURSOR_CHANGE,
        ({ socketId, cursor, username: remoteUsername }) => {
          // Clear any existing marker for this socket
          if (remoteCursorsRef.current[socketId]) {
            remoteCursorsRef.current[socketId].clear();
          }
          // Create a container for the marker widget
          const markerContainer = document.createElement("div");
          markerContainer.style.position = "relative";
          markerContainer.style.display = "inline-block";

          // Create the vertical line indicator for the cursor
          const cursorIndicator = document.createElement("div");
          cursorIndicator.style.borderLeft = `2px solid ${getColorForUser(remoteUsername)}`;
          cursorIndicator.style.marginLeft = "-1px";
          cursorIndicator.style.height = `${editorRef.current.defaultTextHeight()}px`;
          cursorIndicator.style.display = "inline-block";

          // Create a label to display the remote username
          const label = document.createElement("div");
          label.textContent = remoteUsername;
          label.style.position = "absolute";
          label.style.top = "-20px"; // Adjust to position the label above the cursor
          label.style.left = "0";
          label.style.backgroundColor = getColorForUser(remoteUsername);
          label.style.color = "#fff";
          label.style.fontSize = "10px";
          label.style.padding = "2px 4px";
          label.style.borderRadius = "4px";
          label.style.whiteSpace = "nowrap";

          // Append the label and the cursor indicator to the container
          markerContainer.appendChild(label);
          markerContainer.appendChild(cursorIndicator);

          // Place the widget at the remote user's cursor position
          remoteCursorsRef.current[socketId] = editorRef.current.setBookmark(cursor, {
            widget: markerContainer,
          });
        }
      );

      // Remove remote cursor markers when a user disconnects
      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId }) => {
        if (remoteCursorsRef.current[socketId]) {
          remoteCursorsRef.current[socketId].clear();
          delete remoteCursorsRef.current[socketId];
        }
      });
    }

    return () => {
      socketRef.current.off(ACTIONS.CODE_CHANGE);
      socketRef.current.off(ACTIONS.CURSOR_CHANGE);
      socketRef.current.off(ACTIONS.DISCONNECTED);
    };
  }, [socketRef.current]);

  return <textarea id="realtimeEditor"></textarea>;
};

export default Editor;
