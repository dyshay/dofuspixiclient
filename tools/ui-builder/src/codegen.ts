/**
 * Code generator — converts a PanelDef into a TypeScript HUD component.
 * Since panels are now just node trees, the generator walks children directly.
 */
import type { PanelDef, PanelNode } from './schema';

function hex(n: number): string {
  return '0x' + n.toString(16).padStart(6, '0');
}

function escStr(s: string): string {
  return s.replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function pascalCase(s: string): string {
  return s.replace(/(^|[_-])(\w)/g, (_, _sep, c: string) => c.toUpperCase());
}

export function generateCode(def: PanelDef): string {
  const className = pascalCase(def.name) + 'Panel';
  const lines: string[] = [];

  lines.push(`import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';`);
  lines.push(`import { boldText, regularText, createSlot, createProgressBar, createCloseButton } from '../core';`);
  lines.push('');
  lines.push(`const W = ${def.w};`);
  lines.push(`const H = ${def.h};`);
  lines.push('');
  lines.push(`export class ${className} {`);
  lines.push(`  public container: Container;`);
  lines.push(`  private onClose?: () => void;`);
  lines.push('');
  lines.push(`  constructor() {`);
  lines.push(`    this.container = new Container();`);
  lines.push(`    this.container.label = '${def.name}-panel';`);
  lines.push(`    this.container.visible = false;`);
  lines.push(`    this.container.eventMode = 'static';`);
  lines.push('');

  let varIdx = 0;
  for (const child of def.children) {
    const code = nodeToCode(child, () => `_v${varIdx++}`, '    ');
    lines.push(code);
    lines.push('');
  }

  lines.push(`  }`);
  lines.push('');
  lines.push(`  toggle(): void { this.container.visible = !this.container.visible; }`);
  lines.push(`  show(): void { this.container.visible = true; }`);
  lines.push(`  hide(): void { this.container.visible = false; }`);
  lines.push(`  isVisible(): boolean { return this.container.visible; }`);
  lines.push(`  setScale(s: number): void { this.container.scale.set(s); }`);
  lines.push(`  setPosition(x: number, y: number): void { this.container.x = x; this.container.y = y; }`);
  lines.push(`  setOnClose(fn: () => void): void { this.onClose = fn; }`);
  lines.push(`  destroy(): void { this.container.destroy({ children: true }); }`);
  lines.push(`}`);

  return lines.join('\n');
}

function nodeToCode(node: PanelNode, nextVar: () => string, indent: string): string {
  const v = nextVar();

  switch (node.type) {
    case 'rect': {
      const shape = node.radius ? 'roundRect' : 'rect';
      const args = node.radius
        ? `${node.x}, ${node.y}, ${node.w}, ${node.h}, ${node.radius}`
        : `${node.x}, ${node.y}, ${node.w}, ${node.h}`;
      let code = `${indent}const ${v} = new Graphics();\n`;
      code += `${indent}${v}.${shape}(${args});\n`;
      if (node.fill != null) {
        code += `${indent}${v}.fill({ color: ${hex(node.fill)}${node.fillAlpha != null && node.fillAlpha !== 1 ? `, alpha: ${node.fillAlpha}` : ''} });\n`;
      }
      if (node.stroke != null) {
        code += `${indent}${v}.${shape}(${args});\n`;
        code += `${indent}${v}.stroke({ color: ${hex(node.stroke)}, width: ${node.strokeWidth ?? 1} });\n`;
      }
      code += `${indent}this.container.addChild(${v});`;
      return code;
    }

    case 'text': {
      const styleFn = node.bold ? 'boldText' : 'regularText';
      let code = `${indent}const ${v} = new Text({ text: '${escStr(node.value)}', style: ${styleFn}(${node.size ?? 11}, ${hex(node.color ?? 0x3d3529)}) });\n`;
      code += `${indent}${v}.x = ${node.x}; ${v}.y = ${node.y};\n`;
      if (node.anchorX != null || node.anchorY != null) {
        code += `${indent}${v}.anchor.set(${node.anchorX ?? 0}, ${node.anchorY ?? 0});\n`;
      }
      code += `${indent}this.container.addChild(${v});`;
      return code;
    }

    case 'slot': {
      let code = `${indent}const ${v} = createSlot(${node.x}, ${node.y}, ${node.size});\n`;
      code += `${indent}this.container.addChild(${v}.graphics);\n`;
      code += `${indent}this.container.addChild(${v}.iconSprite);`;
      return code;
    }

    case 'bar': {
      let code = `${indent}const ${v} = createProgressBar(${node.x}, ${node.y}, ${node.w}, ${node.h});\n`;
      code += `${indent}this.container.addChild(${v}.graphics);\n`;
      code += `${indent}${v}.redraw(${node.value ?? 0});`;
      return code;
    }

    case 'sprite': {
      let code = `${indent}const ${v} = new Sprite(Texture.EMPTY);\n`;
      code += `${indent}${v}.x = ${node.x}; ${v}.y = ${node.y};\n`;
      code += `${indent}${v}.width = ${node.w}; ${v}.height = ${node.h};\n`;
      if (node.alpha != null && node.alpha !== 1) code += `${indent}${v}.alpha = ${node.alpha};\n`;
      code += `${indent}this.container.addChild(${v});`;
      if (node.src) {
        code += `\n${indent}Assets.load('${node.src}').then((tex: Texture) => { ${v}.texture = tex; ${v}.width = ${node.w}; ${v}.height = ${node.h}; }).catch(() => {});`;
      }
      return code;
    }

    case 'divider': {
      let code = `${indent}const ${v} = new Graphics();\n`;
      code += `${indent}${v}.rect(${node.x}, ${node.y}, ${node.w}, ${node.h});\n`;
      code += `${indent}${v}.fill({ color: ${hex(node.color ?? 0x8a7f5f)} });\n`;
      code += `${indent}this.container.addChild(${v});`;
      return code;
    }

    case 'group': {
      let code = `${indent}// Group${node.id ? ': ' + node.id : ''}\n`;
      code += `${indent}const ${v} = new Container();\n`;
      if (node.edges) {
        code += `${indent}${v}.x = ${node.edges.l}; ${v}.y = ${node.edges.t};\n`;
      } else if (node.x || node.y) {
        code += `${indent}${v}.x = ${node.x ?? 0}; ${v}.y = ${node.y ?? 0};\n`;
      }
      code += `${indent}this.container.addChild(${v});\n`;
      for (const child of node.children) {
        code += nodeToCode(child, nextVar, indent) + '\n';
      }
      return code;
    }

    case 'repeat-column': {
      let code = `${indent}for (let i = 0; i < ${node.count}; i++) {\n`;
      code += `${indent}  const dy = ${node.y} + i * (${node.template.size} + ${node.gap});\n`;
      code += `${indent}  const s = createSlot(${node.x}, dy, ${node.template.size});\n`;
      code += `${indent}  this.container.addChild(s.graphics);\n`;
      code += `${indent}  this.container.addChild(s.iconSprite);\n`;
      code += `${indent}}`;
      return code;
    }

    default:
      return `${indent}// ${node.type} node — implement manually`;
  }
}
