import './style.css';
import App, { ToastContainer, ConfirmDialog } from './App.jsx';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <ToastContainer />
    <ConfirmDialog />
  </>
);
