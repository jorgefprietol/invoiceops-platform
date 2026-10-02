pipeline {
  agent { label 'linux-docker-node24' }
  options { timestamps(); timeout(time: 25, unit: 'MINUTES'); disableConcurrentBuilds() }
  environment { COMPOSE_PROJECT_NAME = "invoiceops-jenkins-${BUILD_NUMBER}" }
  stages {
    stage('Quality') { steps { sh 'npm ci --ignore-scripts && npm run verify && npm audit --audit-level=high' } }
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
  post { always { sh 'docker compose down --volumes --remove-orphans' } }
}
