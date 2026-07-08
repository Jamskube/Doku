// Génère 09-stress-500k.md : ~500 Ko de markdown réaliste et varié.
import { writeFileSync } from 'node:fs';

const blocks = [
  (i) => `## Section ${i} — notes de travail\n`,
  (i) => `Paragraphe ${i} avec du **gras**, de l'*italique*, du \`code\`, un [[lien-note-${i}]] et un [lien](https://example.com/${i}). Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n`,
  (i) => `- [ ] tâche ${i} à faire\n- [x] tâche ${i} terminée\n- point ${i} avec *emphase*\n`,
  (i) => '```javascript\nfunction bloc' + i + '() {\n  return ' + i + ' * 42;\n}\n```\n',
  (i) => `> Citation ${i} : la légèreté est une discipline, pas une absence.\n`,
  (i) => `| clé | valeur |\n|---|---|\n| item ${i} | ${i * 7} |\n| poids | ${i % 100} Ko |\n`,
];

let out = '# Document de stress — 500 Ko\n\n';
let i = 0;
while (Buffer.byteLength(out, 'utf8') < 500 * 1024) {
  out += blocks[i % blocks.length](i) + '\n';
  i++;
}
writeFileSync(new URL('./09-stress-500k.md', import.meta.url), out);
console.log(`OK: ${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(0)} Ko, ${i} blocs`);
