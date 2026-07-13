FROM node:23-alpine
WORKDIR /usr/app

COPY /dist/app /usr/app/dist/app

ENV PORT=80

CMD ["node", "dist/app/server/server.mjs"]

EXPOSE 80
