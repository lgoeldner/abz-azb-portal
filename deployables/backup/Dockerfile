FROM postgres:18-alpine
RUN apk add --no-cache restic curl coreutils bash util-linux
RUN mkdir -p /status && chmod 0777 /status
COPY deployables/backup/backup.sh /usr/local/bin/backup.sh
COPY deployables/backup/restore.sh /usr/local/bin/restore.sh
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
