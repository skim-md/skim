// Bundle entry for mermaid: re-exports the default export so mermaid.js can
// dynamic-import the built dist/mermaid.bundle.js and pull `mod.default`.
import mermaid from 'mermaid';
export default mermaid;
