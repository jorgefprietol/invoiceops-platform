pipeline {
  agent { label 'linux-docker-node24' }
  options { timestamps(); timeout(time: 25, unit: 'MINUTES'); disableConcurrentBuilds() }
  environment { COMPOSE_PROJECT_NAME = "invoiceops-jenkins-${BUILD_NUMBER}" }
  stages {
    stage('Quality') {
      steps {
        sh '''
          set -eu
          db="invoiceops-jenkins-test-${BUILD_NUMBER}"
          trap 'docker rm -f "$db" >/dev/null 2>&1 || true' EXIT
          docker run --rm -d --name "$db" --memory=256m -p 127.0.0.1::5432 \
            -e POSTGRES_USER=invoiceops -e POSTGRES_PASSWORD=integration-only \
            -e POSTGRES_DB=invoiceops \
            postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
          for attempt in $(seq 1 60); do
            docker exec "$db" pg_isready -U invoiceops -d invoiceops && break
            sleep 1
          done
          port=$(docker port "$db" 5432/tcp | awk -F: '{print $NF}')
          export DATABASE_URL="postgres://invoiceops:integration-only@127.0.0.1:$port/invoiceops"
          npm ci --ignore-scripts
          npm run verify
          npm audit --audit-level=high
        '''
      }
    }
    stage('Build and acceptance') {
      steps {
        sh '''
          npm run init
          docker compose up --build -d --wait --wait-timeout 300
          npm run smoke
        '''
      }
    }
    stage('Archive release metadata') {
      steps {
        sh 'mkdir -p .artifacts && docker image inspect invoiceops-api:local invoiceops-web:local > .artifacts/jenkins-images.json'
        archiveArtifacts artifacts: '.artifacts/jenkins-images.json', fingerprint: true
      }
    }
  }
  post { always { sh 'if test -f .env; then docker compose down --volumes --remove-orphans; fi' } }
}
