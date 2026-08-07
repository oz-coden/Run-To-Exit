using UnityEngine;
using UnityEngine.InputSystem;

namespace RunToExit.Core
{
    public class PlayerController : CharacterBase
    {
        private InputAction moveAction;
        private InputAction sprintAction;

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

            sprintAction = new InputAction("Sprint", binding: "<Keyboard>/leftShift");
            sprintAction.AddBinding("<Gamepad>/buttonEast"); // Bボタンなど
        }

        private void OnEnable()
        {
            moveAction.Enable();
            sprintAction.Enable();
        }

        private void OnDisable()
        {
            moveAction.Disable();
            sprintAction.Disable();
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
            bool isSprinting = sprintAction.IsPressed();

            // 左右の移動入力を優先
            if (Mathf.Abs(inputVector.x) > 0.1f)
            {
                int dirX = inputVector.x > 0 ? 1 : -1;
                Vector2Int targetPos = GridPosition + new Vector2Int(dirX, 0);
                
                if (CanMoveTo(targetPos, out MovableBox box, out NPCController npcHit))
                {
                    // 移動先に床がない（穴）の場合、スプリント中なら幅跳び判定
                    if (isSprinting && IsGap(targetPos))
                    {
                        if (TryLongJump(dirX)) return;
                    }

                    StartCoroutine(MoveRoutine(targetPos, box));
                }
                else if (npcHit != null && !npcHit.IsRescued)
                {
                    npcHit.Rescue();
                }
                else if (box == null && npcHit == null) // 箱でもNPCでも塞がれているわけではない（壁である）場合
                {
                    if (!TryStepUp(targetPos))
                    {
                        TryLedgeGrab(dirX);
                    }
                }
            }
            // 上下はフェーズ2での「はしご昇降」「ジャンプ」等のため一旦保留
            // else if (Mathf.Abs(inputVector.y) > 0.1f) { ... }
        }

        private bool IsGap(Vector2Int targetPos)
        {
            Vector2Int below = targetPos + Vector2Int.down;
            Collider2D hit = GridManager.Instance.GetObjectAt(below);
            return hit == null;
        }
    }
}
