const ALLOWED_BASE_COMMANDS = new Set([
  'npm',
  'npx',
  'node',
  'yarn',
  'pnpm',
  'cat',
  'ls',
  'mkdir',
  'cp',
  'mv',
  'rm',
  'echo',
  'cd',
  'pwd',
  'which',
  'python',
  'python3',
  'pip',
  'pip3',
]);

const DANGEROUS_PATTERNS = [
  /[;|`]/,           // Shell chaining / pipe / backtick
  /\$\(/,            // Command substitution
  /\$\{/,            // Variable expansion
  />{1,2}/,          // Output redirection
  /<{1,2}/,          // Input redirection
  /\b&&\b/,          // AND operator
  /\|\|/,            // OR operator
  /\beval\b/,        // eval command
  /\bexec\b/,        // exec command
  /\bsource\b/,      // source command
  /\bcurl\b/,        // curl (prevent data exfiltration)
  /\bwget\b/,        // wget
  /\bnc\b/,          // netcat
  /\/etc\//,         // System file access
  /\/proc\//,        // Process file access
  /\/dev\//,         // Device access
  /npm\s+(publish|login|adduser|token|owner|access)/, // npm registry manipulation
  /--global\b/,      // Global installs
  /\s-g\b/,          // Global installs shorthand
];

export function sanitizeCommand(command: string): {
  isValid: boolean;
  error?: string;
} {
  const trimmed = command.trim();

  if (!trimmed) {
    return { isValid: false, error: 'Command cannot be empty' };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isValid: false,
        error: `Command contains disallowed pattern: ${pattern.source}`,
      };
    }
  }

  // Extract the base command (first token)
  const baseCommand = trimmed.split(/\s+/)[0];

  if (!ALLOWED_BASE_COMMANDS.has(baseCommand)) {
    return {
      isValid: false,
      error: `Command '${baseCommand}' is not in the allowed list. Allowed: ${[...ALLOWED_BASE_COMMANDS].join(', ')}`,
    };
  }

  // Block installing from URLs (could be malicious tarballs)
  if (/^(npm|yarn|pnpm)\s+(install|i|add)\b/.test(trimmed)) {
    if (/https?:\/\//.test(trimmed) || /\.tgz\b/.test(trimmed)) {
      return {
        isValid: false,
        error: 'Installing from URLs or tarballs is not allowed',
      };
    }
  }

  return { isValid: true };
}
