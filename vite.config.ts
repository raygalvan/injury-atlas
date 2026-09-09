import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error Build-only JavaScript transformer.
import { instrumentUi } from './scripts/afp-ui-compiler.mjs';
export default defineConfig({
  plugins: [{name:'afp-ui-surfaces',enforce:'pre',transform(code,id){const file=id.split('/src/')[1];if(file && id.endsWith('.tsx'))return {code:instrumentUi(code,'src/'+file).code,map:null};}},react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3100",
      "/atlas-engine": "http://127.0.0.1:3100",
    },
  },
  build: { outDir: "dist" },
});
