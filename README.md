한국어 | [English](./README.en.md)

## 환경 준비

### Linux 환경

1. 필요한 의존성을 설치합니다.

    ```bash
    sudo apt-get update && sudo apt-get install -y vim python3-pip curl git
    pip3 install --upgrade pip
    pip install docker-compose
    ```

2. Docker를 설치합니다.

    스크립트로 설치: `sudo curl -sSL https://get.docker.com | sh`

    자세한 설치 절차는 [https://docs.docker.com/install/](https://docs.docker.com/install/) 를 참고하세요.

### Windows 환경

Windows 환경의 설치는 체험 용도로만 권장되며, 운영 환경에서는 사용하지 마세요. 필요하다면 가상 머신에 Linux를 설치한 뒤 그 안에 OJ를 설치하세요.

아래 안내는 `Windows 10 x64`의 `PowerShell` 기준입니다.

1. Windows용 Docker 도구를 설치합니다.
2. 작업 표시줄 오른쪽 아래의 Docker 아이콘을 우클릭한 뒤 `Settings`를 엽니다.
3. `Shared Drives` 메뉴에서 OJ를 설치할 드라이브를 선택하고 `Apply`를 클릭합니다.
4. Windows 계정 비밀번호를 입력해 파일 공유를 완료합니다.
5. `Python`, `pip`, `git`, `docker-compose`를 설치합니다.

## 설치 시작

1. 디스크 여유 공간이 있는 위치를 선택한 뒤 아래 명령을 실행합니다.

    ```bash
    git clone -b 2.0 https://github.com/QingdaoU/OnlineJudgeDeploy.git && cd OnlineJudgeDeploy
    ```

2. 서비스를 시작합니다.

    ```bash
    docker-compose up -d
    ```

네트워크 속도에 따라 약 5분에서 30분 정도면 별도 개입 없이 설치가 완료됩니다.

명령 실행이 끝난 뒤 `docker ps -a`를 실행했을 때 모든 컨테이너 상태에 `unhealthy` 또는 `Exited (x) xxx`가 없다면 OJ가 정상적으로 시작된 것입니다.

## 사용 시작

브라우저에서 서버의 HTTP `80` 포트 또는 HTTPS `443` 포트로 접속하면 사용할 수 있습니다. 관리자 페이지 경로는 `/admin`이며, 설치 과정에서 자동 생성되는 슈퍼 관리자 계정은 사용자명 `root`, 비밀번호 `rootroot`입니다. **로그인 후 반드시 즉시 비밀번호를 변경하세요.**

문서도 함께 확인하세요: http://opensource.qduoj.com/

## 커스터마이징

2.0 버전에서는 자주 사용하는 일부 설정을 관리자 페이지에서 직접 변경할 수 있으므로, 코드 수정 없이도 시스템 설정이 가능합니다.

시스템 수정이나 2차 개발이 필요하다면 각 모듈의 `README`를 참고하세요. 수정 후에는 직접 Docker 이미지를 빌드하고 `docker-compose.yml`도 함께 조정해야 합니다.

## 문제가 있나요?

[http://opensource.qduoj.com/](http://opensource.qduoj.com/#/onlinejudge/faq) 를 참고하세요. 그 외 문제는 커뮤니티에서 논의하거나 이슈를 등록하면 됩니다.
