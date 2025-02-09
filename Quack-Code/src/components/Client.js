// src/components/Client.js
import React from 'react';
import Avatar from 'react-avatar';

const Client = ({ username, isCurrentUser }) => {
  const containerStyle = isCurrentUser
    ? { border: '2px solid #bdbdff', padding: '2px', borderRadius: '8px' }
    : {};
    
  return (
    <div className="client" style={containerStyle}>
      <Avatar name={username} size={50} round="14px" />
      <span className="userName">{username}</span>
    </div>
  );
};

export default Client;
