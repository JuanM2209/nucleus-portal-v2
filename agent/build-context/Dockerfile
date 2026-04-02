FROM alpine:3.19
RUN apk add --no-cache ca-certificates util-linux libc6-compat
COPY nucleus-agent /usr/local/bin/nucleus-agent
COPY mbusd /usr/local/bin/mbusd
RUN chmod +x /usr/local/bin/nucleus-agent /usr/local/bin/mbusd
ENTRYPOINT ["nucleus-agent"]
