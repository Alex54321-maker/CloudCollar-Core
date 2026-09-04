import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // Подключаем новый плагин

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // Включаем Tailwind прямо в конвейер Vite
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})

