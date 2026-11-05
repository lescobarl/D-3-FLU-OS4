/// <reference types="vite/client" />

// Declaración para archivos CSS
declare module '*.css' {
    const content: string;
    export default content;
}

