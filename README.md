# lrs

Live reload server for static files. Zero dependencies.

## Install

```sh
git clone git@github.com:hideyuki-hori/lrs.git
cd lrs
npm link
```

## Usage

```sh
lrs           # serve current directory on port 3000
lrs 8080      # specify port
```

Open `http://localhost:3000` in a browser. The page reloads automatically when any file under the current directory changes.

## How it works

- Serves files from the current working directory
- Watches the directory recursively with `fs.watch`
- Injects a small SSE client script into HTML responses
- Pushes a reload event to connected clients on file change

## Requirements

- Node.js >= 20.0.0