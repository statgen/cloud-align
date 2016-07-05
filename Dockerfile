FROM ubuntu:14.04
#MAINTAINER Kate Smith <ksmith@example.com>
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    unzip \
    zlib1g-dev

RUN curl -L https://github.com/lh3/bwa/archive/v0.7.15.zip > /root/bwa.zip
RUN unzip /root/bwa.zip -d /root
RUN rm /root/bwa.zip
RUN make -C /root/bwa-0.7.15
RUN ln -s /root/bwa-0.7.15/bwa /usr/bin/bwa

