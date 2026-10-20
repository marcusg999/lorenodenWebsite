#!/usr/bin/env node
'use strict';
/* Create the portal account, or change its password.
     npm run set-password -- <username> <password>
   With no arguments it reads ADMIN_USER / ADMIN_PASSWORD from the environment. */
const { createUser, setPassword, findUser, userCount } = require('./auth');

const [email = process.env.ADMIN_EMAIL || process.env.ADMIN_USER,
       password = process.env.ADMIN_PASSWORD] = process.argv.slice(2);

if (!email || !password) {
  console.error(`
Usage:  npm run set-password -- <email> <password>
   or:  ADMIN_EMAIL=loren@example.com ADMIN_PASSWORD='…' npm run set-password

The password must be at least 12 characters.
Generate a strong one with:  openssl rand -base64 18
`);
  process.exit(1);
}

try {
  if (findUser(email)) {
    setPassword(email, password);
    console.log(`✓ Password updated for ${email}.`);
  } else {
    createUser(email, password);
    console.log(`✓ Created portal account ${email}.`);
  }
  console.log(`  ${userCount()} account(s) exist. Sign in at /admin/login`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
