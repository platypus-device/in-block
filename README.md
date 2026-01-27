# INBLOCK

A node-based infinite canvas for chaining AI prompts. Connect text blocks to build context and generate responses using Gemini and other models.

**Deployed at:** [in-block.vercel.app](https://in-block.vercel.app)

## ✨ Features

- **Infinite Canvas:** Organize your AI workflows visually without boundaries.
- **Smart Connections:** Link blocks together to pass context seamlessly.
- **Multi-Model Support:** Configure and use models from Gemini, OpenAI, and more.
- **Node-Based Workflow:** Add text and image blocks, group them, and organize with auto-layout.
- **Context Management:** Inspect the exact prompt sent to the AI and merge results.
- **Customizable UI:** Support for dark mode and glassmorphism styling.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- An API Key for [Google Gemini](https://aistudio.google.com/app/apikey)

### Local Development

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd block
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Configure API Keys:**
   Open the app in your browser, click the **Settings** (gear icon) at the bottom left, and enter your Gemini API key.

## 🛠️ Tech Stack

- **Framework:** [React 19](https://react.dev/)
- **Bundler:** [Vite](https://vitejs.dev/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/)
- **AI Integration:** [@google/genai](https://www.npmjs.com/package/@google/genai)

