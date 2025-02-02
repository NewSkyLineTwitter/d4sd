#!/usr/bin/env node

import './config/env';

import {
  command,
  flag,
  number,
  option,
  optional,
  restPositionals,
  run,
  string,
} from 'cmd-ts';
import { Shelf } from './shelf/Shelf';
import * as inquirer from 'inquirer';
import { Minimatch, minimatch } from 'minimatch';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PaperFormat } from 'puppeteer';
// @ts-ignore
import { _paperFormats as paperFormats } from 'puppeteer-core';
import { hasOwnProperty } from './util/object';
import { ItemRef } from './item/ItemRef';
import { ScookShelf } from './shelf/ScookShelf';
import { DigiShelf } from './shelf/DigiShelf';

const { version } = JSON.parse(
  readFileSync(join(__dirname, '../package.json')).toString()
);

const cmd = command({
  name: 'd4sd',
  description:
    'Digi4school Downloader\n' +
    '> Downloads books from https://digi4school.at/ and https://www.scook.at/\n' +
    '> GitHub: https://github.com/garzj/d4sd',
  version,
  args: {
    books: restPositionals({
      displayName: 'books',
      type: string,
      description:
        'The titles or urls of books or archives you want to download. Supports glob patterns.',
    }),
    user: option({
      long: 'user',
      short: 'u',
      type: string,
      description: 'Your login email/username.',
    }),
    password: option({
      long: 'password',
      short: 'p',
      type: optional(string),
      description: 'Your login password.',
    }),
    scook: flag({
      long: 'scook',
      short: 's',
      defaultValue: () => false,
      description: 'Login on scook instead.',
    }),
    concurrency: option({
      long: 'concurrency',
      short: 'c',
      type: number,
      defaultValue: () => 10,
      description: 'Specifies the maximum amount of pages downloaded at once.',
    }),
    outDir: option({
      long: 'out-dir',
      short: 'o',
      type: string,
      defaultValue: () => '.',
      description: 'The directory, the item should be saved into.',
    }),
    format: option({
      long: 'format',
      type: optional(string),
      description: 'A puppeteer page format like "a4".',
    }),
    timeout: option({
      long: 'timeout',
      short: 't',
      type: optional(number),
      description: 'Terminates the download, when exceeded.',
    }),
  },
  handler: async (args) => {
    if (args.format && !hasOwnProperty(paperFormats, args.format)) {
      console.error(
        `Invalid page format specified. Possible options are: ${JSON.stringify(
          Object.keys(paperFormats)
        )}`
      );
      return;
    }

    if (args.books.length < 1) {
      console.error('Please specify at least one book title or url.');
      return;
    }

    let password: string;
    if (args.password) {
      password = args.password;
    } else {
      password = (
        await inquirer.prompt({
          name: 'password',
          type: 'password',
        })
      ).password;
      console.log('');
    }

    try {
      const shelf: Shelf = await (args.scook ? ScookShelf : DigiShelf).load({
        user: args.user,
        password,
        timeout: args.timeout,
      });

      try {
        let bookUrls: string[] = [];
        let bookTitles: string[] = [];
        for (const book of args.books) {
          if (book.startsWith(shelf.origin)) {
            bookUrls.push(book);
          } else {
            bookTitles.push(book);
          }
        }

        let itemRefs = bookTitles.length > 0 ? await shelf.getItems() : [];

        // Drop books not specified
        itemRefs = itemRefs.filter(
          (ref) =>
            bookTitles.some((title) =>
              minimatch(ref.title, title, {
                nocase: true,
                dot: true,
                noglobstar: true,
                nocomment: true,
              })
            ) ||
            bookUrls.some(
              (url) => url.replace(/\/$/, '') === ref.url.replace(/\/$/, '')
            )
        );

        // Add the rest of the book urls with the url as title
        for (const bookUrl of bookUrls) {
          if (
            !itemRefs.some(
              (ref) => bookUrl.replace(/\/$/, '') === ref.url.replace(/\/$/, '')
            )
          ) {
            itemRefs.push(new ItemRef(shelf, bookUrl, bookUrl));
          }
        }

        if (itemRefs.length === 0) {
          console.error(`No items matching your rules could be found.`);
        } else {
          for (const itemRef of itemRefs) {
            console.log(`Resolving "${itemRef.title}"...`);
            const item = await itemRef.resolve();
            if (!item) {
              console.error(
                `Failed to resolve item type of "${itemRef.title}".`
              );
              continue;
            }

            console.log(`Downloading "${itemRef.title}"...`);
            try {
              await item.download(args.outDir, {
                ...args,
                format: args.format as PaperFormat,
              });
            } catch (e) {
              console.error(e);
              console.error(`Failed to download "${itemRef.title}!"`);
              continue;
            }
            console.log(`Successfully downloaded "${itemRef.title}"!`);
          }
        }
      } finally {
        if (process.env.NODE_ENV !== 'development') {
          await shelf.destroy();
        }
      }
    } catch (e) {
      console.log(`Error: ${e instanceof Error ? e.message : e}`);
    }
  },
});

run(cmd, process.argv.slice(2));
