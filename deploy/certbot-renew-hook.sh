#!/bin/sh
# Install as /etc/letsencrypt/renewal-hooks/deploy/sansphase-nginx
# with root ownership and mode 0755 after the initial certificate is issued.
set -eu
case " ${RENEWED_DOMAINS:-} " in
  *" www.sansphase.com "*)
    /usr/sbin/nginx -t
    /usr/bin/systemctl reload nginx
    ;;
esac
