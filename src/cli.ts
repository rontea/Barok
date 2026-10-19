#!/usr/bin/env node

import dotenv from 'dotenv';
import { setupAllCommands, parseCommands, setupProcessHandlers } from './cli/commands.js';

dotenv.config();

setupAllCommands();
parseCommands();
setupProcessHandlers();
