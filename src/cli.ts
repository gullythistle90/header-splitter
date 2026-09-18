#!/usr/bin/env node
import { parseList, parseParameters, normalizeHeaderName } from './index';

function usage(): void {
  console.error('usage: header-splitter <list|params|name> <value>');
  console.error('  list "text/html, application/xhtml+xml;q=0.9"');
  console.error('  params "text/html; charset=utf-8"');
  console.error('  name "content-type"');
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const value = rest.join(' ');

  switch (command) {
    case 'list':
      console.log(JSON.stringify(parseList(value)));
      return 0;
    case 'params':
      console.log(JSON.stringify(parseParameters(value)));
      return 0;
    case 'name':
      console.log(normalizeHeaderName(value));
      return 0;
    default:
      usage();
      return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
