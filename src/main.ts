import './ui/styles.css';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('#scene canvas not found');

// Phase 1 で App のブートストラップに置き換える。
