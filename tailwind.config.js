/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}", 
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Nossas cores vibrantes para a militância
        brand: {
          neon: '#ff4500', // Laranja/Vermelho vibrante para o botão "Estou na Luta"
          dark: '#1a1a1a', // Fundo chumbo (Dark Mode)
          light: '#f4f4f5'
        }
      }
    },
  },
  plugins: [],
}