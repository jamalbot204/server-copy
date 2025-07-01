// custom.d.ts

// This tells TypeScript that any import ending in .css is a module.
// It's a way to handle CSS module imports without causing type errors.
declare module '*.css';

// This provides a basic module declaration for mark.es6.js,
// telling TypeScript to treat it as a module of type 'any'.
// This resolves the error about not being able to find its declaration file.
declare module 'mark.js/dist/mark.es6.js';
