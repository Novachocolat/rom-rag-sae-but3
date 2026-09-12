/** @type {import("@commitlint/types").UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'frontend',
        'backend',
        'shared',
        'docker',
        'ci',
        'github',
        'docs',
        'deps',
        'config',
        'db',
        'repo',
      ],
    ],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
}
