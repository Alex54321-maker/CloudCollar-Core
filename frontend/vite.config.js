import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Настройка сборщика и сервера Vite
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Перенаправляем все запросы фронтенда с /api на наш FastAPI бэкенд
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
