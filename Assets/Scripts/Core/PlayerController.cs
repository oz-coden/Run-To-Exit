using UnityEngine;
using UnityEngine.InputSystem;

namespace RunToExit.Core
{
    public class PlayerController : CharacterBase
    {
        private InputAction moveAction;

        private void Awake()
        {
            // Input Systemのスクリプトからの直接定義
            moveAction = new InputAction("Move", binding: "<Gamepad>/dpad");
            moveAction.AddCompositeBinding("Dpad")
                .With("Up", "<Keyboard>/w")
                .With("Up", "<Keyboard>/upArrow")
                .With("Down", "<Keyboard>/s")
                .With("Down", "<Keyboard>/downArrow")
                .With("Left", "<Keyboard>/a")
                .With("Left", "<Keyboard>/leftArrow")
                .With("Right", "<Keyboard>/d")
                .With("Right", "<Keyboard>/rightArrow");
        }

        private void OnEnable()
        {
            moveAction.Enable();
        }

        private void OnDisable()
        {
            moveAction.Disable();
        }

        private void Start()
        {
            // フェーズ1のテスト用ステータス設定（青年ベース）
            Power = 1;
            MoveSpeed = 5f;
            ClimbLimit = 3;
        }

        private void Update()
        {
            if (State != CharacterState.Idle) return;

            Vector2 inputVector = moveAction.ReadValue<Vector2>();

            // 左右の移動入力を優先
            if (Mathf.Abs(inputVector.x) > 0.1f)
            {
                int dirX = inputVector.x > 0 ? 1 : -1;
                Vector2Int targetPos = GridPosition + new Vector2Int(dirX, 0);
                
                if (CanMoveTo(targetPos, out MovableBox box))
                {
                    StartCoroutine(MoveRoutine(targetPos, box));
                }
                else if (box == null) // 箱で塞がれているわけではない（壁である）場合
                {
                    TryStepUp(targetPos);
                    // ここに幅跳びやよじ登りの処理を今後追加します
                }
            }
            // 上下はフェーズ2での「はしご昇降」「ジャンプ」等のため一旦保留
            // else if (Mathf.Abs(inputVector.y) > 0.1f) { ... }
        }
    }
}
