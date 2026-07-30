**git check status**
git status


**git add changes**
git add .


**git commit changes**
git commit -m "Your commit message"


**git push code**
git push


**git push first time**
git push -u origin main


**git pull latest code**
git pull origin main


**git clone repository**
git clone https://github.com/your-username/your-repository.git


**git create new branch**
git branch branch-name


**git switch branch**
git checkout branch-name


**git create and switch branch**
git checkout -b branch-name


**git see all branches**
git branch


**git delete branch**
git branch -d branch-name


**git merge branch**
git checkout main
git merge branch-name


**git view commit history**
git log


**git view short commit history**
git log --oneline


**git undo last commit (keep changes)**
git reset --soft HEAD~1


**git undo last commit (remove changes)**
git reset --hard HEAD~1


**git remove file from git tracking**
git rm --cached filename


**git update remote URL**
git remote set-url origin https://github.com/your-username/your-repository.git


**git check remote repository**
git remote -v


**git stash changes**
git stash


**git restore stash changes**
git stash pop


**git discard file changes**
git checkout -- filename


**git fetch latest updates**
git fetch


**git compare changes**
git diff


**git tag release version**
git tag v1.0.0


**git push tag**
git push origin v1.0.0


**git delete remote branch**
git push origin --delete branch-name


**git delete local branch**
git branch -D branch-name


**git configure username**
git config --global user.name "Your Name"


**git configure email**
git config --global user.email "your-email@example.com"


**git view git configuration**
git config --list