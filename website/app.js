'use strict';
const examples = {
  proxy: { remote: '127.0.0.1:7890', local: '127.0.0.1:7897', text: '服务器访问 7890，就是在用你电脑上的 7897 代理。' },
  service: { remote: '127.0.0.1:3000', local: '127.0.0.1:3000', text: '本机正在开发的接口，在服务器上也能通过 3000 访问。' }
};
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    const example = examples[button.dataset.example];
    for (const other of document.querySelectorAll('[data-example]')) other.setAttribute('aria-pressed', String(other === button));
    document.getElementById('remote-address').textContent = example.remote;
    document.getElementById('local-address').textContent = example.local;
    document.getElementById('example-description').textContent = example.text;
  });
}
const viewer = document.getElementById('image-viewer');
document.getElementById('open-preview').addEventListener('click', () => viewer.showModal());
document.getElementById('close-preview').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', event => {
  if (event.target !== viewer) return;
  const rect = viewer.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
});
