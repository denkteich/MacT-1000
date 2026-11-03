'use strict';
const THEMES = {
  standard: {
    name: 'MacT-1000 Dunkel',
    background: '#0f1115', foreground: '#d7dae0', cursor: '#7ec699', cursorAccent: '#0f1115',
    selectionBackground: '#3a4a63',
    black: '#1d1f21', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d7dae0',
    brightBlack: '#5c6370', brightRed: '#ff7b86', brightGreen: '#b5e890', brightYellow: '#ffd68a', brightBlue: '#8cc8ff', brightMagenta: '#de9bf0', brightCyan: '#7fd8e3', brightWhite: '#ffffff'
  },
  classic: {
    name: 'Klassisch (Schwarz/Grün)',
    background: '#000000', foreground: '#c0ffc0', cursor: '#00ff66', cursorAccent: '#000000',
    selectionBackground: '#1f5f3f',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff'
  },
  solarized: {
    name: 'Solarized Dark',
    background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', cursorAccent: '#002b36',
    selectionBackground: '#0f4b5a',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#93a1a1', brightYellow: '#839496', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  },
  light: {
    name: 'Hell',
    background: '#fbfbfb', foreground: '#24292f', cursor: '#24292f', cursorAccent: '#fbfbfb',
    selectionBackground: '#b6d3ff',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#7d4e00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f'
  }
};
