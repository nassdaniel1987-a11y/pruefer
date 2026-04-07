import React from 'react';

// Avatar-Farbe aus Name generieren (konsistent)
const avatarColors = ['#005A9C', '#28a745', '#dc3545', '#e6a817', '#17a2b8', '#6f42c1', '#e83e8c', '#fd7e14', '#20c997', '#4dabf7'];
const getAvatarColor = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return avatarColors[Math.abs(h) % avatarColors.length];
};
const Avatar = ({ vorname, nachname, size = 'md' }) => {
  const initials = ((vorname || '').charAt(0) + (nachname || '').charAt(0)).toUpperCase();
  const color = getAvatarColor((nachname || '') + (vorname || ''));
  return <div className={`avatar avatar-${size}`} style={{ background: color }}>{initials}</div>;
};

export { Avatar, getAvatarColor, avatarColors };
export default Avatar;
