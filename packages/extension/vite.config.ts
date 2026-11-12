import { defineConfig } from 'vite'
import { createExtensionConfig } from './vite.shared'

export default defineConfig(({ mode }) => createExtensionConfig(__dirname, mode))
