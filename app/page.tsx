'use client';
import styles from "./page.module.css";
import { useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
    const [userID, setUserID] = useState('');
    const [password, setPassword] = useState('');
    const router = useRouter();

    const handleLogin = () => {
        // For now, clicking confirm navigates directly
        router.push('/call');
    };

    const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleLogin();
        }
    };

  return (
      <div className={styles["login-page"]}>
            <div className={styles["login-container"]}>
                <div className={styles["logo-container"]}>
                    <img src="/Amadeuslogo.png" alt="Amadeus Logo" className={styles.logo} />
                </div>

                <div className={styles["login-form"]}>
                    <div className={styles["input-group"]}>
                        <label className={styles["input-label"]}>USER ID</label>
                        <input
                            type="text"
                            value={userID}
                            onChange={(e) => setUserID(e.target.value)}
                            onKeyDown={handleKeyPress}
                            className={styles["login-input"]}
                        />
                    </div>

                    <div className={`${styles["input-group"]} ${styles["password-group"]}`}>
                        <label className={styles["input-label"]}>PASSWORD</label>
                        <div className={styles["password-input-container"]}>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={handleKeyPress}
                                className={`${styles["login-input"]} ${styles["password-input"]}`}
                            />
                            <button onClick={handleLogin} className={styles["enter-button"]}>
                                <img src="/enter.png" alt="Enter" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
  );
}
