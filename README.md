# Fresto frontend

## API (fix “non-JSON” / rider login errors)

1. Start **fresto-backend** on **port 5000** (`npm start` in `eater-backend`).
2. Run **`npm run dev`** here — with `VITE_API_URL=/api`, Vite **proxies** `/api` to **`https://api.vyaharam.com`** (`vite.config.js`). Or set `VITE_API_URL=https://api.vyaharam.com/api` to call the API directly.

Without the backend, responses may be HTML instead of JSON.

Production: optional `VITE_API_URL` in `.env` (see `.env.example`).

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
