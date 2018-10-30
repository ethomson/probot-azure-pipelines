interface PullRequest {
    base: {
        ref: string
    },
    user: User
}

interface User {
    login: string
}
